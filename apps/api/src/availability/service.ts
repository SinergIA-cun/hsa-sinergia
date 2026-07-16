import type { PrismaClient } from '@hsa/database';

export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'apartada' | 'bloqueada';

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: { cotizaciones: number; apartadas: number; formalizadas: number; liquidadas: number };
  quotes: { id: string; cliente: string; status: string }[];
}

/** Otro evento que usa la capilla el mismo día (informativo, no bloquea). */
export interface CapillaEvento {
  quoteId: string;
  cliente: string;
  horario: string | null;
}

/** Rango [inicio, finExclusivo) del día local para la fecha ISO. */
function dayRange(fechaISO: string): { gte: Date; lt: Date } {
  const gte = new Date(`${fechaISO}T00:00:00.000Z`);
  const lt = new Date(gte);
  lt.setUTCDate(lt.getUTCDate() + 1);
  return { gte, lt };
}

// Estatus que "ocupan": borrador/enviada/aceptada = cotización (aviso suave);
// apartada = aviso fuerte; formalizada/liquidada = bloqueo. vencida se ignora.
const COTIZACION = new Set(['borrador', 'enviada', 'aceptada']);
const BLOQUEO = new Set(['formalizada', 'liquidada']);

/**
 * Disponibilidad por espacio+fecha. GLOBAL (no filtra por ventas): cualquiera
 * necesita ver si otra persona ya tiene esa fecha para no sobre-vender.
 */
export async function getAvailability(
  db: PrismaClient,
  fechaISO: string,
  spaceIds: string[],
  excludeQuoteId?: string,
): Promise<{ fecha: string; spaces: SpaceAvailability[]; blocked: boolean; capillaEventos: CapillaEvento[] }> {
  const range = dayRange(fechaISO);
  const [spaces, quotes, capillaQuotes] = await Promise.all([
    db.space.findMany({ where: { id: { in: spaceIds } } }),
    db.quote.findMany({
      where: {
        fechaEvento: range,
        spaceIds: { hasSome: spaceIds },
        status: { not: 'vencida' },
        deletedAt: null,
        ...(excludeQuoteId ? { id: { not: excludeQuoteId } } : {}),
      },
      include: { client: { select: { nombre: true } } },
    }),
    // La capilla la pueden usar VARIOS eventos el mismo día: no bloquea, solo se
    // informa qué otros eventos la tienen y a qué horario, para coordinar.
    db.quote.findMany({
      where: {
        fechaEvento: range,
        usaCapilla: true,
        status: { not: 'vencida' },
        deletedAt: null,
        ...(excludeQuoteId ? { id: { not: excludeQuoteId } } : {}),
      },
      include: { client: { select: { nombre: true } } },
    }),
  ]);

  const capillaEventos: CapillaEvento[] = capillaQuotes.map((q) => ({
    quoteId: q.id,
    cliente: q.client?.nombre ?? 'Cliente',
    horario: q.capillaHorario ?? null,
  }));

  const nombreById = new Map(spaces.map((s) => [s.id, s.nombre]));

  const result: SpaceAvailability[] = spaceIds.map((spaceId) => {
    const relevantes = quotes.filter((q) => q.spaceIds.includes(spaceId));
    const counts = {
      cotizaciones: relevantes.filter((q) => COTIZACION.has(q.status)).length,
      apartadas: relevantes.filter((q) => q.status === 'apartada').length,
      formalizadas: relevantes.filter((q) => q.status === 'formalizada').length,
      liquidadas: relevantes.filter((q) => q.status === 'liquidada').length,
    };
    let level: AvailabilityLevel = 'libre';
    if (relevantes.some((q) => BLOQUEO.has(q.status))) level = 'bloqueada';
    else if (counts.apartadas > 0) level = 'apartada';
    else if (counts.cotizaciones > 0) level = 'cotizaciones';

    return {
      spaceId,
      nombre: nombreById.get(spaceId) ?? spaceId,
      level,
      counts,
      quotes: relevantes.map((q) => ({ id: q.id, cliente: q.client?.nombre ?? 'Cliente', status: q.status })),
    };
  });

  return {
    fecha: fechaISO,
    spaces: result,
    blocked: result.some((s) => s.level === 'bloqueada'),
    capillaEventos,
  };
}

export interface AgendaEvent {
  quoteId: string;
  cliente: string;
  eventoNombre: string;
  fechaEvento: string;
  spaceIds: string[];
  status: string;
  esCortesia: boolean;
}

/** Eventos (cotizaciones no vencidas) en un rango de fechas, para la agenda. */
export async function getAgenda(
  db: PrismaClient,
  fromISO: string,
  toISO: string,
): Promise<{ events: AgendaEvent[] }> {
  const gte = new Date(`${fromISO}T00:00:00.000Z`);
  const lt = new Date(`${toISO}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1);
  const quotes = await db.quote.findMany({
    where: { fechaEvento: { gte, lt }, status: { not: 'vencida' }, deletedAt: null },
    include: { client: { select: { nombre: true } }, eventType: { select: { nombre: true } } },
    orderBy: { fechaEvento: 'asc' },
  });
  return {
    events: quotes.map((q) => ({
      quoteId: q.id,
      cliente: q.client?.nombre ?? 'Cliente',
      eventoNombre: q.eventType?.nombre ?? 'Evento',
      fechaEvento: q.fechaEvento.toISOString(),
      spaceIds: q.spaceIds,
      status: q.status,
      esCortesia: q.esCortesia,
    })),
  };
}
