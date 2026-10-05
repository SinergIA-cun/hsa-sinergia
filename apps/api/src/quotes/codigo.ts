import type { PrismaClient, Prisma } from '@hsa/database';
import { etiquetaEvento } from '@hsa/shared';

/**
 * El código del evento: `04SEP26-HLANGRUEN-CUPULA`.
 *
 * **Es el identificador principal** (decisión del dueño, 1-oct-2026): es el que
 * la operación usa de siempre, el que se ve primero en pantalla, en el recibo y
 * en el BI. Como describe el evento —fecha, cliente, salón— cambia cuando el
 * evento cambia; cada cambio queda en `CodigoEvento`, así que un código viejo
 * impreso en un papel sigue llevando al evento de hoy.
 *
 * El folio (`27SEP-0184`) sigue existiendo como llave interna que nunca cambia,
 * pero ya no es lo que se enseña primero.
 *
 * Por ser principal, dos eventos vivos no comparten código: el segundo lleva
 * sufijo (`-2`, `-3`). El caso real es la cotización duplicada, que nace con la
 * misma fecha, el mismo cliente y el mismo salón. No hay índice único: el folio
 * sigue siendo la llave, y dos altas idénticas en el mismo milisegundo no valen
 * la complejidad de un reintento.
 */

export type MotivoCodigo = 'alta' | 'fecha' | 'espacio' | 'cliente' | 'repetido';

export interface DatosCodigo {
  /** `YYYY-MM-DD`. */
  fecha: string;
  cliente: string;
  /** En orden: el PRIMER espacio es el que entra al código. */
  spaceIds: string[];
  /**
   * Lo que va en el lugar del espacio cuando el evento no ocupa ninguno: un
   * evento solo de capilla (`CAPILLA`) o una sesión de fotos (`FOTOS`). Solo
   * al nacer; después se conserva el que ya traía su código.
   */
  sinSalon?: string;
}

/** El código que le corresponde, sin resolver repetidos. */
async function codigoBase(db: PrismaClient, datos: DatosCodigo, respaldo?: string): Promise<string> {
  if (datos.spaceIds.length === 0) {
    return etiquetaEvento({ fechaISO: datos.fecha, cliente: datos.cliente, espacios: [datos.sinSalon ?? respaldo ?? ''] });
  }
  const spaces = await db.space.findMany({
    where: { id: { in: datos.spaceIds } },
    select: { id: true, nombre: true },
  });
  // `findMany` no garantiza orden, y de él depende qué espacio manda.
  const nombreById = new Map(spaces.map((sp) => [sp.id, sp.nombre]));
  const espacios = datos.spaceIds.map((id) => nombreById.get(id) ?? '');
  return etiquetaEvento({ fechaISO: datos.fecha, cliente: datos.cliente, espacios });
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * El código de un evento con lo que trae HOY.
 *
 * Si el evento ya tenía un código de la misma familia (`X` o `X-n`) y nadie más
 * lo usa, lo conserva: guardar sin cambiar nada no debe mover el código, ni
 * siquiera el sufijo.
 */
export async function calcularCodigo(
  db: PrismaClient,
  datos: DatosCodigo,
  propio?: { id: string; etiqueta: string | null },
): Promise<string> {
  // Sin salón, el lugar del espacio lo conserva el código que ya tenía
  // (`08NOV26-KLATABAN-CAPILLA` movido de fecha sigue siendo `…-CAPILLA`).
  const base = await codigoBase(db, datos, propio?.etiqueta?.split('-')[2]);
  const otros = await db.quote.findMany({
    where: {
      deletedAt: null,
      etiqueta: { startsWith: base },
      ...(propio ? { id: { not: propio.id } } : {}),
    },
    select: { etiqueta: true },
  });
  const tomados = new Set(otros.map((o) => o.etiqueta));
  const familia = new RegExp(`^${escaparRegex(base)}(-\\d+)?$`);

  if (propio?.etiqueta && familia.test(propio.etiqueta) && !tomados.has(propio.etiqueta)) {
    return propio.etiqueta;
  }
  if (!tomados.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidato = `${base}-${n}`;
    if (!tomados.has(candidato)) return candidato;
  }
}

/** Por qué cambió el código, comparando el antes y el después. */
export function motivosDelCambio(
  antes: { fecha: string; cliente: string; spaceIds: string[] },
  despues: { fecha: string; cliente: string; spaceIds: string[] },
): MotivoCodigo[] {
  const motivos: MotivoCodigo[] = [];
  if (antes.fecha !== despues.fecha) motivos.push('fecha');
  if (antes.spaceIds.join('|') !== despues.spaceIds.join('|')) motivos.push('espacio');
  if (antes.cliente.trim() !== despues.cliente.trim()) motivos.push('cliente');
  // Si nada de lo que lo forma cambió, el código se movió por un sufijo.
  return motivos.length > 0 ? motivos : ['repetido'];
}

/**
 * El renglón de historial, listo para crearlo ANIDADO en el `create`/`update`
 * del evento: así el código vigente y su rastro se escriben en la misma
 * sentencia y no puede quedar uno sin el otro.
 */
export function renglonDeCodigo(
  codigo: string,
  datos: DatosCodigo,
  motivos: MotivoCodigo[],
  actorId: string | null | undefined,
): Prisma.CodigoEventoCreateWithoutQuoteInput {
  return {
    codigo,
    motivos,
    fechaEvento: new Date(`${datos.fecha}T00:00:00.000Z`),
    spaceIds: datos.spaceIds,
    ...(actorId ? { actor: { connect: { id: actorId } } } : {}),
  };
}

/** El historial de un evento, del más viejo al vigente. */
export async function historialDeCodigos(db: PrismaClient, quoteId: string) {
  const filas = await db.codigoEvento.findMany({
    where: { quoteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { actor: { select: { nombre: true } } },
  });
  return filas.map((f) => ({
    codigo: f.codigo,
    motivos: f.motivos,
    fechaEvento: f.fechaEvento.toISOString().slice(0, 10),
    desde: f.createdAt.toISOString(),
    actor: f.actor?.nombre ?? null,
  }));
}

/**
 * El evento que tiene o tuvo un código. Primero el vigente; si ninguno lo tiene
 * hoy, el más reciente que lo tuvo. Es lo que permite buscar por el código de un
 * recibo viejo.
 */
export async function eventoPorCodigo(db: PrismaClient, codigo: string): Promise<string | null> {
  const vigente = await db.quote.findFirst({
    where: { etiqueta: codigo, deletedAt: null },
    select: { id: true },
  });
  if (vigente) return vigente.id;
  const historico = await db.codigoEvento.findFirst({
    where: { codigo, quote: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: { quoteId: true },
  });
  return historico?.quoteId ?? null;
}
