import { hoyCivilMexico } from '@hsa/shared';
import type { PrismaClient, Prisma } from '@hsa/database';
import { armarFoto, INCLUDE_FOTO, type FotoEvento } from './foto.js';

export interface ResultadoArchivado {
  /** `null` si el evento todavía no pasa, o si la foto no cambió. */
  version: number | null;
  motivo: 'archivado' | 'actualizada' | 'sin-cambios' | 'aun-no-pasa' | 'en-papelera';
}

/** ¿La fecha de este evento ya quedó atrás? El día del evento todavía NO cuenta. */
export function yaPaso(fechaEvento: Date, hoy: Date = hoyCivilMexico()): boolean {
  return fechaEvento.getTime() < hoy.getTime();
}

/**
 * Toma la foto de un evento pasado, si hace falta.
 *
 * Es idempotente y esa es la característica que lo hace utilizable desde cuatro
 * lugares distintos: el barrido del arranque, el registro de un pago, la edición
 * de la hoja operativa y la ruta bajo demanda. Ninguno tiene que preguntarse si
 * otro ya lo hizo.
 *
 * **Solo escribe si el contenido cambió.** Sin esa comparación, cada arranque
 * del contenedor duplicaría la historia entera y la lista de versiones —que
 * existe para enseñar las correcciones— se volvería ruido.
 *
 * El congelamiento al liquidar sale de aquí sin necesitar bandera: una vez
 * liquidado nada vuelve a moverse, así que ninguna llamada posterior encuentra
 * diferencia y no se escribe versión nueva.
 */
export async function archivarEvento(
  db: PrismaClient,
  quoteId: string,
  opts: { hoy?: Date } = {},
): Promise<ResultadoArchivado> {
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: INCLUDE_FOTO });
  if (!quote) return { version: null, motivo: 'aun-no-pasa' };
  // La papelera es evidencia de otra cosa: lo que se eliminó no se archiva como
  // si hubiera sucedido.
  if (quote.deletedAt) return { version: null, motivo: 'en-papelera' };
  if (!yaPaso(quote.fechaEvento, opts.hoy)) return { version: null, motivo: 'aun-no-pasa' };

  const espacios = await db.space.findMany({ select: { id: true, nombre: true } });
  const { foto, resumen } = await armarFoto(db, quote, new Map(espacios.map((e) => [e.id, e.nombre])));

  const ultima = await db.eventoHistorico.findFirst({
    where: { quoteId },
    orderBy: { version: 'desc' },
  });

  // La comparación deja fuera `tomadaEnISO` a propósito: es lo único que cambia
  // siempre, y compararlo haría que dos fotos idénticas nunca se vieran iguales.
  if (ultima && mismaFoto(ultima.foto, foto)) {
    return { version: ultima.version, motivo: 'sin-cambios' };
  }

  const version = (ultima?.version ?? 0) + 1;
  const motivo = ultima ? 'actualizada' : 'archivado';
  const completa: FotoEvento = { ...foto, tomadaEnISO: new Date().toISOString() };

  await db.eventoHistorico.create({
    data: {
      quoteId,
      version,
      motivo,
      fechaEvento: quote.fechaEvento,
      folio: quote.folio,
      etiqueta: quote.etiqueta,
      foto: completa as unknown as Prisma.InputJsonValue,
      ...resumen,
    },
  });
  return { version, motivo };
}

/**
 * ¿Es la misma foto?
 *
 * Se ignora `tomadaEnISO`, que cambia siempre, y se compara con las llaves
 * ORDENADAS. Lo segundo no es un adorno: Postgres guarda `jsonb` con sus propias
 * llaves reordenadas, así que la foto que vuelve de la base nunca sale igual a la
 * recién armada en un `JSON.stringify` a secas. Sin esto, cada llamada escribía
 * una versión nueva de todo y el archivo se llenaba de copias idénticas.
 */
function mismaFoto(guardada: unknown, nueva: Omit<FotoEvento, 'tomadaEnISO'>): boolean {
  if (guardada == null || typeof guardada !== 'object') return false;
  const resto: Record<string, unknown> = { ...(guardada as Record<string, unknown>) };
  delete resto.tomadaEnISO;
  return estable(resto) === estable(nueva);
}

/** JSON con las llaves de cada objeto en orden alfabético, a cualquier profundidad. */
function estable(valor: unknown): string {
  return JSON.stringify(valor, (_llave, v) => {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
  });
}

export interface ResultadoBarrido {
  revisados: number;
  archivados: number;
  actualizados: number;
}

/**
 * Barre los eventos pasados que aún no tienen foto o cuya foto puede haber
 * cambiado.
 *
 * Es la RED DE SEGURIDAD, no la fuente de verdad: lo que la interfaz muestra
 * como pasado se deriva de la fecha, no de que esto haya corrido. Aquí no hay
 * planificador —los trabajos solo corren al arrancar el contenedor— así que un
 * histórico que dependiera de este barrido dejaría de ser cierto en cuanto
 * pasaran tres semanas sin despliegue.
 *
 * No toca los que ya están liquidados y fotografiados: ésos ya no cambian, y
 * recalcularles la foto en cada arranque sería pagar por nada.
 */
export async function barridoHistorico(
  db: PrismaClient,
  opts: { hoy?: Date } = {},
): Promise<ResultadoBarrido> {
  const hoy = opts.hoy ?? hoyCivilMexico();
  const pendientes = await db.quote.findMany({
    where: {
      fechaEvento: { lt: hoy },
      deletedAt: null,
      // Se revisa lo que no tiene foto y lo que todavía no está liquidado. Un
      // evento liquidado y fotografiado ya no cambia: recalcularle la foto en
      // cada arranque sería pagar por nada.
      //
      // Se mira el estatus VIVO y no solo la foto: si a un evento liquidado se le
      // revierte el estatus, tiene que volver a entrar al barrido. Con un simple
      // "no tiene foto liquidada" quedaría congelado para siempre con una foto
      // que ya no corresponde.
      OR: [{ historico: { none: {} } }, { status: { not: 'liquidada' } }],
    },
    select: { id: true },
    orderBy: { fechaEvento: 'asc' },
  });

  const salida: ResultadoBarrido = { revisados: pendientes.length, archivados: 0, actualizados: 0 };
  for (const { id } of pendientes) {
    const r = await archivarEvento(db, id, { hoy });
    if (r.motivo === 'archivado') salida.archivados++;
    else if (r.motivo === 'actualizada') salida.actualizados++;
  }
  return salida;
}
