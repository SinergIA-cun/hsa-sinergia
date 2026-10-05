import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { enTransaccionConActor, type PrismaClient, type Prisma } from '@hsa/database';
import {
  compararEvento,
  desgloseImportado,
  emparejarNombre,
  formasPagoSchema,
  metodoCapturaSchema,
  normalizarNombre,
  resolverFormasPago,
  FormasPagoError,
  type Diferencia,
  type EventoComparable,
} from '@hsa/shared';
import { catalogoActivo, loadEstadoCuenta } from '../quotes/service.js';
import { esUpgrade } from '../quotes/estadoCuenta.js';
import { logActivity } from '../quotes/activityLog.js';
import { calcularCodigo, eventoPorCodigo, renglonDeCodigo } from '../quotes/codigo.js';
import { reclasificarConceptos } from '../payments/conceptos.js';
import { apartadoVivo } from '../banqueteros/apartados.js';
import { archivarEvento } from '../historico/archivar.js';
import { subirSecuenciaSobre } from '../payments/folios.js';
import { INCLUDE_TITULAR, titularDeApartado } from '../banqueteros/titular.js';

/**
 * El BI le manda a la hacienda los eventos que ya estaban vendidos antes del
 * sistema, de cualquier fecha, y los dos lados se concilian. Uno que ya pasó
 * entra igual que los demás y queda archivado en el Histórico en ese momento.
 *
 * Reglas de diseño:
 *  - **Idempotente por `idBI`.** Mandar el mismo lote dos veces no duplica nada.
 *  - **Nunca pisa.** Si el evento ya existe aquí, no se sobrescribe: desde la
 *    importación, la operación vive en la hacienda (aquí se registran los pagos
 *    de septiembre en adelante). Las diferencias se REPORTAN para que la gente
 *    las cuadre, no se resuelven en silencio.
 *  - **Ante la duda, no importa.** Un salón o tipo de evento que no se reconoce,
 *    o un evento que se parece a uno que ya existe (misma fecha y salón), se
 *    reporta y se salta. Para ligarlo a uno que ya existe se reenvía con
 *    `folioHSA` o con su `codigo`.
 *  - **El código es la identidad de la operación.** Si el BI manda el `codigo`
 *    con el que el evento ya circula (`04SEP26-HLANGRUEN-CUPULA`) y aquí hay un
 *    evento que lo tiene o lo tuvo, es ese evento. Si no hay ninguno, el evento
 *    nuevo nace con ese mismo código para no cambiarle el nombre.
 *  - **Precio pactado.** El desglose son los montos del BI; el catálogo nunca
 *    lo recotiza (ver `updateQuote`).
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');
const pesos = z.number().int().nonnegative();

export const pagoBISchema = z.object({
  idBI: z.string().min(1).max(100).optional(),
  /** El folio de la hoja foliada (serie I). Obligatorio: un pago viejo sin folio
   *  gastaría uno nuevo de la serie, y ese número ya es de otro recibo. */
  folio: z.number().int().positive(),
  fecha: fechaISO,
  monto: z.number().int().positive(),
  metodo: metodoCapturaSchema.optional(),
  formas: formasPagoSchema.optional(),
  referencia: z.string().max(120).optional(),
});

export const eventoBISchema = z.object({
  idBI: z.string().min(1).max(100),
  /** Para ligar el evento del BI a uno que YA existe aquí (su folio de evento). */
  folioHSA: z.string().min(1).max(40).optional(),
  /**
   * El código con el que el evento ya circula (`04SEP26-HLANGRUEN-CUPULA`). Liga
   * contra el código vigente o cualquiera de los anteriores; si nadie lo tiene,
   * es el código con el que se crea.
   */
  codigo: z.string().trim().min(1).max(60).optional(),
  fechaContratacion: fechaISO,
  fechaEvento: fechaISO,
  tipoEvento: z.string().min(1).max(80),
  salones: z.array(z.string().min(1).max(80)).min(1).max(3),
  invitados: z.number().int().positive(),
  cliente: z.object({
    nombre: z.string().trim().min(1).max(200),
    telefono: z.string().max(40).optional(),
    correo: z.string().max(200).optional(),
  }),
  banquetero: z.string().max(200).nullish(),
  festejado: z.string().max(200).nullish(),
  vendedora: z.string().max(200).nullish(),
  /** Lo que cobra la hacienda, con IVA. Es el precio pactado. */
  renta: z.object({ total: pesos }),
  /** Alimentos y servicios (se pagan al proveedor), con IVA. */
  otros: z.object({ total: pesos }).optional(),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  horaTermino: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  pagos: z.array(pagoBISchema).max(200).default([]),
});

export const loteSchema = z.object({
  eventos: z.array(eventoBISchema).min(1).max(200),
  /**
   * Hasta qué fecha tiene pagos el BI. Del lado de la hacienda solo se comparan
   * los pagos hasta ese día: los de después solo existen aquí y es lo esperado.
   */
  pagosHasta: fechaISO.optional(),
  /**
   * El BI declara que el lote trae TODOS sus eventos. Solo así tiene sentido
   * reportar los que la hacienda tiene y el BI no.
   */
  completo: z.boolean().default(false),
});

export type EventoBI = z.infer<typeof eventoBISchema>;
export type Lote = z.infer<typeof loteSchema>;

export type Estado =
  | 'nuevo'
  | 'igual'
  | 'difiere'
  | 'posibleDuplicado'
  | 'invalido';

export interface Candidato {
  tipo: 'evento' | 'apartado';
  id: string;
  folio: string | null;
  cliente: string | null;
  estatus: string;
}

export interface Resultado {
  idBI: string;
  estado: Estado;
  /** El folio del evento aquí, si existe (o si se creó). */
  folioHSA?: string;
  /** Su código vigente aquí, que es el principal. */
  codigoHSA?: string | null;
  quoteId?: string;
  diferencias?: Diferencia[];
  candidatos?: Candidato[];
  errores?: string[];
  avisos?: string[];
  /** Lo que hizo la importación: `creado`, `ligado`, o nada. */
  accion?: 'creado' | 'ligado';
}

export interface Catalogos {
  espacios: { id: string; nombre: string }[];
  tipos: { id: string; nombre: string; slug: string }[];
  banqueteros: { id: string; nombre: string }[];
  usuarios: { id: string; nombre: string }[];
}

export async function cargarCatalogos(db: PrismaClient): Promise<Catalogos> {
  const [espacios, tipos, banqueteros, usuarios] = await Promise.all([
    db.space.findMany({ select: { id: true, nombre: true } }),
    db.eventType.findMany({ select: { id: true, nombre: true, slug: true } }),
    db.banquetero.findMany({ select: { id: true, nombre: true } }),
    db.user.findMany({ select: { id: true, nombre: true } }),
  ]);
  return { espacios, tipos, banqueteros, usuarios };
}

/** Traduce los nombres del BI a los registros de aquí. */
function resolver(ev: EventoBI, c: Catalogos) {
  const errores: string[] = [];
  const avisos: string[] = [];
  const spaceIds: string[] = [];
  for (const s of ev.salones) {
    const hit = emparejarNombre(s, c.espacios);
    if (hit) spaceIds.push(hit.id);
    else errores.push(`El salón "${s}" no se reconoce.`);
  }
  const tipo = emparejarNombre(ev.tipoEvento, c.tipos);
  if (!tipo) errores.push(`El tipo de evento "${ev.tipoEvento}" no se reconoce.`);
  let banqueteroId: string | null = null;
  if (ev.banquetero) {
    const b = emparejarNombre(ev.banquetero, c.banqueteros);
    if (b) banqueteroId = b.id;
    else avisos.push(`El banquetero "${ev.banquetero}" no está dado de alta: el evento entra sin banquetero.`);
  }
  let vendedoraId: string | null = null;
  if (ev.vendedora) {
    const v = c.usuarios.filter((u) => normalizarNombre(u.nombre) === normalizarNombre(ev.vendedora!));
    if (v.length === 1) vendedoraId = v[0]!.id;
    else avisos.push(`La vendedora "${ev.vendedora}" no se reconoce: el evento queda sin vendedora.`);
  }
  if (ev.fechaContratacion > ev.fechaEvento) {
    errores.push('La fecha de contratación es posterior a la del evento.');
  }
  for (const p of ev.pagos) {
    try {
      resolverFormasPago({ monto: p.monto, metodo: p.metodo, formas: p.formas });
    } catch (e) {
      if (e instanceof FormasPagoError) errores.push(`Pago con folio I ${p.folio}: ${e.message}`);
      else throw e;
    }
  }
  const repetidos = ev.pagos.map((p) => p.folio).filter((f, i, a) => a.indexOf(f) !== i);
  if (repetidos.length) errores.push(`Folios repetidos en los pagos: ${[...new Set(repetidos)].join(', ')}.`);
  return { errores, avisos, spaceIds, eventTypeId: tipo?.id ?? null, banqueteroId, vendedoraId };
}

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** El lado de la hacienda de la comparación, recortado a la ventana del BI. */
async function comparableHSA(
  db: PrismaClient,
  quote: { id: string; fechaEvento: Date; spaceIds: string[]; invitados: number; eventTypeId: string; rentaTotal: number },
  pagosHasta?: string,
): Promise<EventoComparable> {
  const pagos = await db.payment.findMany({
    where: {
      quoteId: quote.id,
      destino: 'evento',
      anuladoAt: null,
      ...(pagosHasta ? { fecha: { lte: dia(pagosHasta) } } : {}),
    },
    select: { monto: true, folio: true },
  });
  return {
    fechaEvento: quote.fechaEvento.toISOString().slice(0, 10),
    spaceIds: quote.spaceIds,
    invitados: quote.invitados,
    eventTypeId: quote.eventTypeId,
    rentaTotal: quote.rentaTotal,
    pagado: pagos.reduce((s, p) => s + p.monto, 0),
    folios: pagos.map((p) => p.folio),
  };
}

const QUOTE_SELECT = {
  id: true,
  folio: true,
  etiqueta: true,
  importadoBI: true,
  deletedAt: true,
  status: true,
  fechaEvento: true,
  spaceIds: true,
  invitados: true,
  eventTypeId: true,
  rentaTotal: true,
  client: { select: { nombre: true } },
} as const;

/** Un evento del lote contra la base, SIN escribir nada. */
async function conciliarUno(
  db: PrismaClient,
  ev: EventoBI,
  c: Catalogos,
  pagosHasta: string | undefined,
): Promise<Resultado & { _resuelto?: ReturnType<typeof resolver> }> {
  const r = resolver(ev, c);
  if (r.errores.length) return { idBI: ev.idBI, estado: 'invalido', errores: r.errores, avisos: r.avisos };

  let existente = await db.quote.findUnique({ where: { importadoBI: ev.idBI }, select: QUOTE_SELECT });
  if (!existente && ev.folioHSA) {
    existente = await db.quote.findUnique({ where: { folio: ev.folioHSA }, select: QUOTE_SELECT });
    if (!existente) {
      return { idBI: ev.idBI, estado: 'invalido', errores: [`No existe un evento con el folio ${ev.folioHSA}.`] };
    }
    if (existente.importadoBI && existente.importadoBI !== ev.idBI) {
      return {
        idBI: ev.idBI,
        estado: 'invalido',
        errores: [`El evento ${ev.folioHSA} ya está ligado al evento ${existente.importadoBI} del BI.`],
      };
    }
  }
  if (!existente && ev.codigo) {
    const id = await eventoPorCodigo(db, ev.codigo);
    if (id) {
      existente = await db.quote.findUnique({ where: { id }, select: QUOTE_SELECT });
      if (existente?.importadoBI && existente.importadoBI !== ev.idBI) {
        return {
          idBI: ev.idBI,
          estado: 'invalido',
          errores: [`El evento ${ev.codigo} ya está ligado al evento ${existente.importadoBI} del BI.`],
        };
      }
    }
  }

  const ladoBI: EventoComparable = {
    fechaEvento: ev.fechaEvento,
    spaceIds: r.spaceIds,
    invitados: ev.invitados,
    eventTypeId: r.eventTypeId,
    rentaTotal: ev.renta.total,
    pagado: ev.pagos.reduce((s, p) => s + p.monto, 0),
    folios: ev.pagos.map((p) => p.folio),
  };

  if (existente) {
    if (existente.deletedAt) {
      return {
        idBI: ev.idBI,
        estado: 'difiere',
        folioHSA: existente.folio,
        codigoHSA: existente.etiqueta,
        quoteId: existente.id,
        avisos: [...r.avisos, 'Aquí el evento está en la papelera.'],
        diferencias: [],
      };
    }
    const diferencias = compararEvento(ladoBI, await comparableHSA(db, existente, pagosHasta));
    return {
      idBI: ev.idBI,
      estado: diferencias.length ? 'difiere' : 'igual',
      folioHSA: existente.folio,
      codigoHSA: existente.etiqueta,
      quoteId: existente.id,
      diferencias,
      avisos: r.avisos,
      _resuelto: r,
    };
  }

  // Sin liga: ¿se parece a algo que ya está aquí? Misma fecha y algún salón en
  // común. Puede ser el mismo evento capturado a mano, o un empalme real; en
  // cualquiera de los dos casos lo decide una persona, no la importación.
  const fecha = dia(ev.fechaEvento);
  const [mismos, apartados] = await Promise.all([
    db.quote.findMany({
      where: { fechaEvento: fecha, deletedAt: null, spaceIds: { hasSome: r.spaceIds } },
      select: QUOTE_SELECT,
    }),
    db.apartadoFecha.findMany({
      where: { fechaEvento: fecha, quoteId: null, canceladoAt: null, spaceIds: { hasSome: r.spaceIds } },
      select: { id: true, canceladoAt: true, quoteId: true, vence: true, ...INCLUDE_TITULAR },
    }),
  ]);
  const candidatos: Candidato[] = [
    ...mismos.map((q) => ({ tipo: 'evento' as const, id: q.id, folio: q.folio, cliente: q.client?.nombre ?? null, estatus: q.status })),
    ...apartados
      .filter((a) => apartadoVivo(a))
      .map((a) => ({ tipo: 'apartado' as const, id: a.id, folio: null, cliente: titularDeApartado(a), estatus: 'apartado' })),
  ];
  if (candidatos.length) {
    return {
      idBI: ev.idBI,
      estado: 'posibleDuplicado',
      candidatos,
      avisos: [
        ...r.avisos,
        'Ya hay algo aquí en esa fecha y salón. Si es el mismo evento, reenvíalo con folioHSA o codigo para ligarlo.',
      ],
    };
  }
  return { idBI: ev.idBI, estado: 'nuevo', avisos: r.avisos, _resuelto: r };
}

/** Los eventos que la hacienda tiene y el BI no mandó. */
async function soloEnHSA(db: PrismaClient, lote: Lote, resultados: Resultado[]) {
  const vistos = new Set(resultados.map((r) => r.quoteId).filter(Boolean));
  const idsBI = lote.eventos.map((e) => e.idBI);
  const quotes = await db.quote.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['borrador', 'standby', 'cancelada'] },
      OR: [{ importadoBI: null }, { importadoBI: { notIn: idsBI } }],
    },
    select: { id: true, folio: true, etiqueta: true, fechaEvento: true, importadoBI: true, client: { select: { nombre: true } } },
    orderBy: { fechaEvento: 'asc' },
  });
  return quotes
    .filter((q) => !vistos.has(q.id))
    .map((q) => ({
      quoteId: q.id,
      folioHSA: q.folio,
      codigoHSA: q.etiqueta,
      fechaEvento: q.fechaEvento.toISOString().slice(0, 10),
      cliente: q.client?.nombre ?? null,
      idBI: q.importadoBI,
    }));
}

const quitarInterno = ({ _resuelto, ...r }: Resultado & { _resuelto?: unknown }): Resultado => {
  void _resuelto;
  return r;
};

function resumen(resultados: Resultado[]) {
  const conteo: Partial<Record<Estado | 'creados' | 'ligados', number>> = {};
  for (const r of resultados) {
    conteo[r.estado] = (conteo[r.estado] ?? 0) + 1;
    if (r.accion === 'creado') conteo.creados = (conteo.creados ?? 0) + 1;
    if (r.accion === 'ligado') conteo.ligados = (conteo.ligados ?? 0) + 1;
  }
  return conteo;
}

/** Compara el lote con la base. No escribe NADA. */
export async function conciliarLote(db: PrismaClient, raw: unknown) {
  const lote = loteSchema.parse(raw);
  const c = await cargarCatalogos(db);
  const resultados: Resultado[] = [];
  for (const ev of lote.eventos) resultados.push(quitarInterno(await conciliarUno(db, ev, c, lote.pagosHasta)));
  return {
    resumen: resumen(resultados),
    resultados,
    ...(lote.completo ? { soloEnHSA: await soloEnHSA(db, lote, resultados) } : {}),
  };
}

/** `26FEB-0213`: año y mes de la CONTRATACIÓN, igual que `folio_evento()`. */
async function folioDeContratacion(tx: Prisma.TransactionClient, fechaContratacion: string): Promise<string> {
  const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const [fila] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('evento_folio_seq') AS n`;
  const [y, m] = fechaContratacion.split('-') as [string, string];
  return `${y.slice(2)}${MESES[Number(m) - 1]}-${String(Number(fila!.n)).padStart(4, '0')}`;
}

/** Crea UN evento importado con sus pagos, todo o nada. */
async function crearImportado(db: PrismaClient, ev: EventoBI, r: ReturnType<typeof resolver>) {
  const catalogo = await catalogoActivo(db);
  const lista = await db.priceList.findUniqueOrThrow({ where: { id: catalogo.id }, select: { ivaRate: true } });
  const espacios = await db.space.findMany({ where: { id: { in: r.spaceIds } }, select: { id: true, nombre: true } });
  const salones = r.spaceIds.map((id) => ({ spaceId: id, nombre: espacios.find((e) => e.id === id)?.nombre ?? id }));
  const breakdown = desgloseImportado({
    salones,
    rentaTotal: ev.renta.total,
    otrosTotal: ev.otros?.total ?? 0,
    ivaRate: lista.ivaRate,
  });

  const quote = await enTransaccionConActor(async (tx) => {
    const tel = ev.cliente.telefono?.replace(/\D/g, '') || null;
    // El cliente se reutiliza solo si el teléfono coincide EXACTO: dos "María
    // López" no son la misma persona, y fundirlas mezclaría sus estados de cuenta.
    const existente = tel
      ? (await tx.client.findMany({ where: { telefono: { not: null } }, select: { id: true, telefono: true } })).find(
          (cl) => cl.telefono?.replace(/\D/g, '') === tel,
        )
      : undefined;
    const clientId =
      existente?.id ??
      (
        await tx.client.create({
          data: { nombre: ev.cliente.nombre, telefono: ev.cliente.telefono ?? null, correo: ev.cliente.correo ?? null },
        })
      ).id;

    const folio = await folioDeContratacion(tx, ev.fechaContratacion);
    const datosCodigo = { fecha: ev.fechaEvento, cliente: ev.cliente.nombre, spaceIds: r.spaceIds };
    // El código con el que ya circula, si el BI lo mandó y nadie más lo usa aquí;
    // si no, el que le toca. (Si lo usara otro evento, la conciliación ya lo
    // habría ligado a ese y no estaríamos creando.)
    const libre =
      ev.codigo && !(await tx.quote.findFirst({ where: { etiqueta: ev.codigo, deletedAt: null }, select: { id: true } }));
    const etiqueta = libre ? ev.codigo! : await calcularCodigo(tx as unknown as PrismaClient, datosCodigo);
    const q = await tx.quote.create({
      data: {
        folio,
        etiqueta,
        codigos: { create: renglonDeCodigo(etiqueta, datosCodigo, ['alta'], null) },
        clientId,
        eventTypeId: r.eventTypeId!,
        fechaEvento: dia(ev.fechaEvento),
        invitados: ev.invitados,
        spaceIds: r.spaceIds,
        breakdown: breakdown as unknown as Prisma.InputJsonValue,
        total: breakdown.total,
        rentaTotal: breakdown.rentaTotal,
        // Un evento del BI es un evento VENDIDO: bloquea su fecha aunque no traiga
        // pagos. Si los pagos ya cruzaron un hito, el estatus sube después.
        status: 'formalizada',
        publicToken: randomUUID().replace(/-/g, ''),
        banqueteroId: r.banqueteroId,
        festejado: ev.festejado ?? null,
        horaInicio: ev.horaInicio ?? null,
        horaTermino: ev.horaTermino ?? null,
        createdById: r.vendedoraId,
        priceListId: catalogo.id,
        importadoBI: ev.idBI,
        contratadoEl: dia(ev.fechaContratacion),
      },
    });
    for (const p of ev.pagos) {
      const forma = resolverFormasPago({ monto: p.monto, metodo: p.metodo, formas: p.formas });
      await tx.payment.create({
        data: {
          quoteId: q.id,
          monto: p.monto,
          metodo: forma.metodo,
          formas: forma.formas ?? undefined,
          concepto: 'aCuenta',
          fecha: dia(p.fecha),
          referencia: p.referencia ?? null,
          // El folio de la hoja de papel: es el número que ya tiene el cliente.
          folio: p.folio,
          importadoBI: p.idBI ?? null,
        },
      });
    }
    return q;
  }, db);
  // La serie automática queda por encima de los folios de papel que trajo: el
  // siguiente recibo del mostrador no puede repetir uno de ellos.
  const maxFolio = Math.max(0, ...ev.pagos.map((p) => p.folio));
  if (maxFolio > 0) await subirSecuenciaSobre(db, maxFolio);

  await logActivity(db, {
    quoteId: quote.id,
    tipo: 'creada',
    descripcion: `Importado del BI (evento ${ev.idBI}), contratado el ${ev.fechaContratacion}, con ${ev.pagos.length} pago(s) y precio pactado`,
    meta: { importadoBI: ev.idBI, contratadoEl: ev.fechaContratacion, pagos: ev.pagos.length },
    actorId: null,
  });
  // Los conceptos se deducen del saldo y el estatus sube si los pagos ya cruzaron
  // un hito, por la misma vía que un pago capturado aquí.
  await reclasificarConceptos(db, quote);
  const { estadoCuenta } = await loadEstadoCuenta(db, quote);
  if (esUpgrade(quote.status, estadoCuenta.sugerido)) {
    await db.quote.update({ where: { id: quote.id }, data: { status: estadoCuenta.sugerido! } });
    await logActivity(db, {
      quoteId: quote.id,
      tipo: 'estatus',
      descripcion: `Estatus: ${quote.status} → ${estadoCuenta.sugerido} (automático por pagos importados)`,
      meta: { de: quote.status, a: estadoCuenta.sugerido, auto: true },
      actorId: null,
    });
  }
  // Un evento cerrado (agosto, septiembre) ya pasó: se archiva ahora y no hasta el
  // próximo arranque del contenedor. Si todavía no se celebra, no hace nada.
  await archivarEvento(db, quote.id);
  return quote;
}

/**
 * Importa el lote: crea los `nuevo`, liga los que vienen con `folioHSA`, y
 * reporta todo lo demás sin tocarlo. Con `simular` es igual a conciliar.
 *
 * Cada evento va en su propia transacción: uno que falla no tumba el lote, y
 * reintentar el lote completo es seguro porque todo es idempotente por `idBI`.
 */
export async function importarLote(db: PrismaClient, raw: unknown) {
  const lote = loteSchema.parse(raw);
  const c = await cargarCatalogos(db);
  const resultados: Resultado[] = [];
  for (const ev of lote.eventos) {
    const res = await conciliarUno(db, ev, c, lote.pagosHasta);
    if (res.estado === 'nuevo' && res._resuelto) {
      try {
        const q = await crearImportado(db, ev, res._resuelto);
        resultados.push({ ...quitarInterno(res), quoteId: q.id, folioHSA: q.folio, codigoHSA: q.etiqueta, accion: 'creado' });
      } catch (e) {
        resultados.push({
          idBI: ev.idBI,
          estado: 'invalido',
          errores: [`No se pudo crear: ${e instanceof Error ? e.message : String(e)}`],
        });
      }
      continue;
    }
    // Ligar: el BI dijo cuál es con `folioHSA` y el evento aún no tenía liga. No
    // se cambia ningún dato: solo se anota el id, y las diferencias se reportan.
    if (res.quoteId && (ev.folioHSA || ev.codigo) && (res.estado === 'igual' || res.estado === 'difiere')) {
      const q = await db.quote.findUniqueOrThrow({ where: { id: res.quoteId }, select: { importadoBI: true } });
      if (!q.importadoBI) {
        await db.quote.update({ where: { id: res.quoteId }, data: { importadoBI: ev.idBI } });
        await logActivity(db, {
          quoteId: res.quoteId,
          tipo: 'edicion',
          descripcion: `Ligado al evento ${ev.idBI} del BI`,
          meta: { importadoBI: ev.idBI },
          actorId: null,
        });
        resultados.push({ ...quitarInterno(res), accion: 'ligado' });
        continue;
      }
    }
    resultados.push(quitarInterno(res));
  }
  return {
    resumen: resumen(resultados),
    resultados,
    ...(lote.completo ? { soloEnHSA: await soloEnHSA(db, lote, resultados) } : {}),
  };
}
