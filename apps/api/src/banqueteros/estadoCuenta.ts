import type { PrismaClient } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { QuoteError, loadEstadoCuentaBulk } from '../quotes/service.js';
import { listarDepositos, saldoLiberadoPorApartados } from './cuenta.js';
import { listarApartados } from './apartados.js';

/**
 * El estado de cuenta del banquetero: sus eventos, sus depósitos, cómo se
 * repartieron, su saldo sin asignar y sus apartados por vencer.
 *
 * "Ramírez trae $158,345 sin repartir" es el número por el que después hay
 * discusiones, y hoy no se puede decir sin sentarse a sumar. Esto solo mata el
 * hilo de WhatsApp.
 *
 * NO filtra por pertenencia (`ownershipWhere`): el saldo de una contraparte es
 * uno solo, y un estado de cuenta que enseñara "los eventos de este banquetero
 * que además son míos" daría un saldo que no cuadra con el dinero. Es la misma
 * razón por la que `getAvailability` es global.
 */

/** Días dentro de los cuales un apartado se considera "por vencer". */
export const DIAS_POR_VENCER = 30;

export async function estadoCuentaBanquetero(
  db: PrismaClient,
  banqueteroId: string,
  opts: { hoy?: Date } = {},
) {
  const banquetero = await db.banquetero.findUnique({
    where: { id: banqueteroId },
    select: { id: true, nombre: true, telefono: true, correo: true, activo: true, publicToken: true },
  });
  if (!banquetero) throw new QuoteError(404, 'Banquetero no encontrado');
  const hoy = opts.hoy ?? hoyCivilMexico();

  const [quotes, depositos, apartados] = await Promise.all([
    // La papelera NO aparece: es evidencia de auditoría, no cartera viva.
    db.quote.findMany({
      where: { banqueteroId, deletedAt: null },
      select: {
        id: true,
        folio: true,
        etiqueta: true,
        fechaEvento: true,
        status: true,
        total: true,
        rentaTotal: true,
        spaceIds: true,
        breakdown: true,
        festejado: true,
        festejadoTelefono: true,
        client: { select: { id: true, nombre: true } },
        priceList: { select: { id: true, nombre: true } },
      },
      orderBy: { fechaEvento: 'asc' },
    }),
    listarDepositos(db, banqueteroId),
    listarApartados(db, banqueteroId, { hoy }),
  ]);

  // El estado de cuenta de todos sus eventos en una sola tanda de consultas: un
  // banquetero con cuatro eventos no debe costar cuatro veces el mismo trabajo.
  const ecs = await loadEstadoCuentaBulk(db, quotes);

  const eventos = quotes.map((q) => {
    const ec = ecs.get(q.id);
    return {
      quoteId: q.id,
      folio: q.folio,
      etiqueta: q.etiqueta,
      fechaEventoISO: q.fechaEvento.toISOString(),
      status: q.status,
      cliente: q.client?.nombre ?? null,
      festejado: q.festejado,
      festejadoTelefono: q.festejadoTelefono,
      catalogo: q.priceList?.nombre ?? null,
      total: q.total,
      rentaTotal: q.rentaTotal,
      pagado: ec?.pagado ?? 0,
      saldo: ec?.saldo ?? q.rentaTotal,
      planPendiente: ec?.planPendiente ?? true,
    };
  });

  /**
   * Σ depósitos vivos − Σ asignaciones vivas. Se suman los saldos por depósito
   * porque cada uno ya resolvió sus propias anulaciones (las del depósito y las
   * de sus asignaciones).
   */
  const saldoSinAsignar = depositos.reduce((s, d) => s + d.saldoSinAsignar, 0);
  const depositado = depositos.filter((d) => d.anuladoAt == null).reduce((s, d) => s + d.monto, 0);

  /*
   * El dinero de las fechas que se soltaron.
   *
   * Un apartado que venció o se canceló ya no bloquea nada, así que lo que el
   * banquetero le había abonado vuelve a ser suyo. Se calcula, NO se mueve: no
   * se crea un depósito ni se reescribe el abono. El dinero entró el día que
   * entró —y así se factura— y lo único que cambió es contra qué está apartado.
   *
   * Aquí solo entran los abonos DIRECTOS. Los que salieron de un depósito ya
   * volvieron solos a su saldo, porque `saldoSinAsignar` dejó de descontarlos.
   */
  // Menos lo que ya se le devolvió de ese saldo liberado (las devoluciones que
  // salen de un depósito ya las descuenta el saldo de su depósito).
  const devoluciones = await db.devolucion.findMany({
    where: { banqueteroId },
    orderBy: { fecha: 'desc' },
    include: {
      registradoBy: { select: { nombre: true } },
      pagoBanquetero: { select: { id: true, folio: true } },
    },
  });
  const devueltoDelLiberado = devoluciones
    .filter((d) => d.pagoBanqueteroId == null && d.anuladoAt == null)
    .reduce((s, d) => s + d.monto, 0);
  const saldoLiberado = saldoLiberadoPorApartados(apartados, hoy) - devueltoDelLiberado;

  const vivos = apartados.filter((a) => a.vivo);
  const limite = new Date(hoy);
  limite.setUTCDate(limite.getUTCDate() + DIAS_POR_VENCER);
  const porVencer = vivos
    .filter((a) => a.vence.getTime() <= limite.getTime())
    .sort((a, b) => a.vence.getTime() - b.vence.getTime());

  return {
    banquetero,
    eventos,
    depositos,
    apartados,
    apartadosPorVencer: porVencer,
    devoluciones,
    totales: {
      eventos: eventos.length,
      // Solo de las cotizaciones: un apartado no tiene total y no es una venta
      // cerrada, así que no entra a ningún número de ingreso comprometido.
      rentaTotal: eventos.reduce((s, e) => s + e.rentaTotal, 0),
      pagado: eventos.reduce((s, e) => s + e.pagado, 0),
      saldo: eventos.reduce((s, e) => s + e.saldo, 0),
      depositado,
      saldoSinAsignar,
      /** Lo que el banquetero trae a favor: sin repartir más lo que soltaron sus fechas. */
      saldoAFavor: saldoSinAsignar + saldoLiberado,
      saldoLiberado,
      /** Lo que se le ha devuelto de su saldo a favor (sin anuladas). */
      devuelto: devoluciones.filter((d) => d.anuladoAt == null).reduce((s, d) => s + d.monto, 0),
      apartadosVivos: vivos.length,
      apartadosPorVencer: porVencer.length,
    },
  };
}

/**
 * La misma cuenta por el enlace de solo lectura.
 *
 * Es una PROYECCIÓN, no el objeto interno: se recorta a mano lo que el banquetero
 * puede ver. Devolver el objeto completo filtraría las llaves de los comprobantes,
 * los ids de quién registró cada cosa y el motivo de cada anulación — y cada
 * campo nuevo del interno se publicaría solo, sin que nadie lo decidiera.
 *
 * **Los depósitos NO salen de aquí.** Por decisión del dueño el banquetero ve su
 * saldo a favor, su saldo por cubrir y sus eventos, y nada más: la lista de
 * depósitos deja ver de un vistazo cuánto factura la hacienda con él al año, y
 * ése es un número de la casa. Tampoco sale el TOTAL depositado, que diría lo
 * mismo en una sola cifra — por eso `totales` se arma campo por campo en vez de
 * pasarse entero, como estaba antes.
 *
 * `null` (y no un error) cuando el token no existe: quien llama responde 404 sin
 * distinguir "no existe" de "no es tuyo".
 */
export async function estadoCuentaPublico(db: PrismaClient, token: string) {
  const banquetero = await db.banquetero.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!banquetero) return null;
  const ec = await estadoCuentaBanquetero(db, banquetero.id);

  return {
    banquetero: { nombre: ec.banquetero.nombre, telefono: ec.banquetero.telefono },
    eventos: ec.eventos.map((e) => ({
      folio: e.folio,
      etiqueta: e.etiqueta,
      fechaEventoISO: e.fechaEventoISO,
      status: e.status,
      festejado: e.festejado,
      total: e.total,
      rentaTotal: e.rentaTotal,
      pagado: e.pagado,
      saldo: e.saldo,
    })),
    apartados: ec.apartados
      .filter((a) => a.vivo)
      .map((a) => ({
        fechaEventoISO: a.fechaEvento.toISOString(),
        spaceIds: a.spaceIds,
        abonado: a.abonado,
        venceISO: a.vence.toISOString(),
        catalogo: a.priceList?.nombre ?? null,
      })),
    totales: {
      eventos: ec.totales.eventos,
      /** Dinero suyo que todavía no se aplica a ningún evento. */
      saldoAFavor: ec.totales.saldoAFavor,
      /** Lo que falta por pagar de sus eventos. */
      saldoPorCubrir: ec.totales.saldo,
      apartadosVivos: ec.totales.apartadosVivos,
    },
  };
}
