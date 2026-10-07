import type { PrismaClient, Payment } from '@hsa/database';
import { afectaContrato, formatFolio, partesDePago, FORMA_PAGO_LABEL, hoyCivilMexico, type Marca, type MetodoPago } from '@hsa/shared';
import { loadEstadoCuenta, QuoteError } from '../quotes/service.js';
import type { Mailer } from './mailer.js';
import { correoBienvenida, correoCierre, correoRecibo, type EventoCorreo, type PagoCorreo } from './plantillas.js';
import { reciboPdf } from './reciboPdf.js';
import { sumarHabiles } from './habiles.js';

// La cola de correos al cliente (decisión del dueño, 6-oct-2026):
// - `bienvenida` al formalizar el evento (con el recibo del pago que lo formalizó);
// - `recibo` por cada pago que se registra, con su PDF;
// - `cierre` a los 2 días hábiles del evento: gracias, total con extras y
//   una invitación a recomendarnos.
// Se encola en el momento y el proceso del servidor (`iniciarCorreos`) los manda.

/** Cuántas veces se reintenta un correo que falló. */
const MAX_INTENTOS = 5;
/** Un correo que no se pudo mandar en este tiempo ya no se manda (avalancha vieja). */
const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;
/** El cierre solo se encola para eventos recientes: al estrenar esto no se les escribe a los de hace meses. */
const VENTANA_CIERRE_DIAS = 10;

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const tieneCorreo = (c: string | null | undefined): c is string => !!c && CORREO_VALIDO.test(c.trim());

type Tipo = 'bienvenida' | 'recibo' | 'cierre';

/** Encola un correo. Si ya existe (misma `clave`) no hace nada: cada cosa se avisa una vez. */
export async function encolarCorreo(db: PrismaClient, quoteId: string, tipo: Tipo, paymentId?: string | null) {
  const clave = tipo === 'recibo' ? `recibo:${paymentId}` : `${tipo}:${quoteId}`;
  await db.correoCliente.upsert({
    where: { clave },
    create: { quoteId, tipo, clave, paymentId: paymentId ?? null },
    update: {},
  });
}

/**
 * Al formalizar hace falta el correo del cliente: ahí le llegan su confirmación y
 * sus recibos (decisión del dueño). Para cotizar basta el teléfono.
 */
export async function exigirCorreoParaFormalizar(db: PrismaClient, quoteId: string, monto?: number) {
  const q = await db.quote.findUnique({ where: { id: quoteId }, include: { client: { select: { correo: true } } } });
  if (!q || q.status !== 'borrador' || tieneCorreo(q.client?.correo)) return;
  // Con un pago: solo si ese pago lo formaliza (llega al apartado). Sin plan de
  // pagos no hay cómo saberlo, así que se pide igual.
  if (monto != null) {
    const { estadoCuenta } = await loadEstadoCuenta(db, q);
    const apartar = estadoCuenta.plan?.find((m) => m.key === 'apartar');
    if (apartar && estadoCuenta.pagado + monto < apartar.objetivo) return;
  }
  throw new QuoteError(
    409,
    'Captura el correo del cliente antes de formalizar: ahí le llegan su confirmación y sus recibos.',
  );
}

const CONCEPTO: Record<string, string> = {
  anticipo: 'Anticipo',
  aCuenta: 'Abono a cuenta',
  complemento: 'Abono a cuenta',
  finiquito: 'Finiquito',
};

function pagoCorreo(p: Payment): PagoCorreo {
  return {
    folio: formatFolio(p.folio, p.folioLetra),
    monto: p.monto,
    fecha: p.fecha.toISOString().slice(0, 10),
    concepto: p.destino === 'cargos' ? 'Cargos adicionales del evento' : (CONCEPTO[p.concepto] ?? p.concepto),
    formas: partesDePago(p).map((f) => ({ forma: FORMA_PAGO_LABEL[f.forma as MetodoPago] ?? f.forma, monto: f.monto })),
  };
}

async function datosDelEvento(db: PrismaClient, quoteId: string) {
  const q = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { client: true, eventType: { select: { nombre: true } } },
  });
  const [espacios, { estadoCuenta }] = await Promise.all([
    db.space.findMany({ where: { id: { in: q.spaceIds } }, select: { id: true, nombre: true } }),
    loadEstadoCuenta(db, q),
  ]);
  const nombre = new Map(espacios.map((s) => [s.id, s.nombre]));
  const evento: EventoCorreo & { referencia: number | null } = {
    cliente: q.client.nombre,
    referencia: q.client.numeroReferencia ?? null,
    codigo: q.etiqueta,
    tipoEvento: q.eventType?.nombre ?? null,
    fecha: q.fechaEvento.toISOString().slice(0, 10),
    salones: q.spaceIds.map((id) => nombre.get(id) ?? '').filter(Boolean),
    invitados: q.invitados,
    renta: q.rentaTotal,
    pagado: estadoCuenta.pagado,
    saldo: estadoCuenta.saldo,
    plan: estadoCuenta.plan?.map((m) => ({ label: m.label, objetivo: m.objetivo, completo: m.completo, venceISO: m.venceISO })) ?? null,
  };
  return { q, evento };
}

/** Arma el mensaje de un correo de la cola (sin mandarlo). */
export async function armarCorreo(
  db: PrismaClient,
  marca: Marca,
  c: { tipo: Tipo; quoteId: string; paymentId: string | null },
  ahora = new Date(),
) {
  const { q, evento } = await datosDelEvento(db, c.quoteId);
  const pago = c.paymentId ? await db.payment.findUnique({ where: { id: c.paymentId } }) : null;
  const vivo = pago && !pago.anuladoAt ? pago : null;
  const adjunto = async (p: Payment) => ({
    filename: `Recibo ${formatFolio(p.folio, p.folioLetra)}.pdf`,
    content: await reciboPdf(marca, evento, pagoCorreo(p), ahora),
    contentType: 'application/pdf',
  });

  if (c.tipo === 'bienvenida') {
    const m = correoBienvenida(marca, evento, vivo ? pagoCorreo(vivo) : null);
    return { para: q.client.correo, q, mensaje: { ...m, attachments: vivo ? [await adjunto(vivo)] : [] } };
  }
  if (c.tipo === 'recibo') {
    if (!vivo) return { para: q.client.correo, q, mensaje: null, motivo: 'El pago se anuló antes de mandar su recibo.' };
    const m = correoRecibo(marca, evento, pagoCorreo(vivo), vivo.destino === 'cargos');
    return { para: q.client.correo, q, mensaje: { ...m, attachments: [await adjunto(vivo)] } };
  }
  // Cierre: el contrato como se firmó y, aparte, todo lo que se agregó en el punto
  // de venta (los que suben el contrato también, sin contarlos dos veces).
  const cargos = await db.cargoEvento.findMany({ where: { quoteId: c.quoteId, anuladoAt: null }, orderBy: { fecha: 'asc' } });
  const delContrato = cargos.filter((x) => afectaContrato(x.producto)).reduce((s, x) => s + x.total, 0);
  const m = correoCierre(marca, evento, {
    contrato: q.total - delContrato,
    extras: cargos.map((x) => ({ nombre: x.descripcion, cantidad: x.cantidad, total: x.total })),
  });
  return { para: q.client.correo, q, mensaje: { ...m, attachments: [] } };
}

/** Manda los correos pendientes. Devuelve cuántos mandó, omitió y fallaron. */
export async function procesarCola(db: PrismaClient, mailer: Mailer | null, marca: Marca, ahora = new Date()) {
  const vencidos = await db.correoCliente.updateMany({
    where: { estado: { in: ['pendiente', 'error'] }, createdAt: { lt: new Date(ahora.getTime() - VIGENCIA_MS) } },
    data: { estado: 'omitido', error: mailer ? 'No se pudo mandar a tiempo.' : 'El correo de salida no está configurado.' },
  });
  const r = { enviados: 0, omitidos: vencidos.count, fallidos: 0 };
  if (!mailer) return r;

  const cola = await db.correoCliente.findMany({
    where: { estado: { in: ['pendiente', 'error'] }, intentos: { lt: MAX_INTENTOS } },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  for (const c of cola) {
    try {
      const quote = await db.quote.findUnique({ where: { id: c.quoteId }, select: { deletedAt: true, status: true } });
      if (!quote || quote.deletedAt || quote.status === 'cancelada') {
        await db.correoCliente.update({ where: { id: c.id }, data: { estado: 'omitido', error: 'El evento ya no está vivo.' } });
        r.omitidos++;
        continue;
      }
      const armado = await armarCorreo(db, marca, c, ahora);
      if (!armado.mensaje || !tieneCorreo(armado.para)) {
        await db.correoCliente.update({
          where: { id: c.id },
          data: { estado: 'omitido', para: armado.para ?? null, error: armado.motivo ?? 'El cliente no tiene correo.' },
        });
        r.omitidos++;
        continue;
      }
      await mailer.send({ to: armado.para.trim(), ...armado.mensaje });
      await db.correoCliente.update({
        where: { id: c.id },
        data: { estado: 'enviado', para: armado.para.trim(), enviadoAt: new Date(), intentos: { increment: 1 }, error: null },
      });
      r.enviados++;
    } catch (e) {
      await db.correoCliente.update({
        where: { id: c.id },
        data: { estado: 'error', intentos: { increment: 1 }, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
      });
      r.fallidos++;
    }
  }
  return r;
}

/**
 * Encola el correo de cierre de los eventos que terminaron hace 2 días hábiles
 * (o un poco más, si el servidor estuvo apagado). Solo eventos recientes.
 */
export async function encolarCierres(db: PrismaClient, hoy = hoyCivilMexico()) {
  const desde = new Date(hoy.getTime() - VENTANA_CIERRE_DIAS * 24 * 60 * 60 * 1000);
  const eventos = await db.quote.findMany({
    where: {
      deletedAt: null,
      status: { in: ['formalizada', 'complementada', 'liquidada'] },
      fechaEvento: { gte: desde, lt: hoy },
      correos: { none: { tipo: 'cierre' } },
    },
    select: { id: true, fechaEvento: true },
  });
  let encolados = 0;
  for (const e of eventos) {
    if (sumarHabiles(e.fechaEvento, 2).getTime() > hoy.getTime()) continue;
    await encolarCorreo(db, e.id, 'cierre');
    encolados++;
  }
  return encolados;
}

/** Vuelve a mandar un correo (desde el evento, admin). */
export async function reenviarCorreo(db: PrismaClient, quoteId: string, correoId: string) {
  const c = await db.correoCliente.findFirst({ where: { id: correoId, quoteId } });
  if (!c) throw new QuoteError(404, 'Correo no encontrado');
  return db.correoCliente.update({
    where: { id: correoId },
    data: { estado: 'pendiente', intentos: 0, error: null, createdAt: new Date() },
  });
}

/**
 * El proceso del servidor: cada minuto encola los cierres del día y manda lo
 * pendiente. Un tropiezo se registra y se reintenta en la siguiente vuelta.
 */
export function iniciarCorreos(db: PrismaClient, mailer: Mailer | null, marca: Marca, cadaMs = 60_000) {
  let corriendo = false;
  const vuelta = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await encolarCierres(db);
      const r = await procesarCola(db, mailer, marca);
      if (r.enviados || r.fallidos) console.log(`Correos: ${r.enviados} enviados, ${r.fallidos} con error, ${r.omitidos} omitidos.`);
    } catch (e) {
      console.error('Correos: falló la vuelta.', e);
    } finally {
      corriendo = false;
    }
  };
  void vuelta();
  return setInterval(() => void vuelta(), cadaMs);
}
