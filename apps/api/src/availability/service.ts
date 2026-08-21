import type { PrismaClient, Prisma } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';

export type AvailabilityLevel = 'libre' | 'cotizaciones' | 'bloqueada';

/**
 * Un apartado de banquetero que bloquea el espacio. Va en su propia lista y no
 * mezclado con `quotes` porque NO es una cotización: no tiene cliente, ni total,
 * ni estatus, y quien lo pinte tiene que poder decirlo distinto.
 */
export interface ApartadoBloqueo {
  apartadoId: string;
  banquetero: string;
  venceISO: string;
  deposito: number;
}

export interface SpaceAvailability {
  spaceId: string;
  nombre: string;
  level: AvailabilityLevel;
  counts: { cotizaciones: number; formalizadas: number; complementadas: number; liquidadas: number; apartados: number };
  quotes: { id: string; cliente: string; status: string }[];
  apartados: ApartadoBloqueo[];
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

// Estatus que "ocupan": `borrador` = cotización sin pago (aviso suave);
// cualquier cosa con compromiso de pago bloquea.
//
// Ya no hay filtro de estatus en las consultas: `vencida` se retiró (punto 8) y
// era lo único que sacaba una cotización vieja de los colores y de la agenda.
// Consecuencia aceptada por el dueño: un borrador viejo sigue pintando su fecha
// en ámbar hasta que alguien lo mande a la papelera. La papelera SÍ se sigue
// excluyendo — `deletedAt: null`.
const COTIZACION = new Set(['borrador']);
const BLOQUEO = new Set(['formalizada', 'complementada', 'liquidada']);

/**
 * Los apartados que de verdad bloquean una fecha, y las tres condiciones que lo
 * deciden:
 *
 * - `canceladoAt: null` — uno cancelado libera la fecha.
 * - `vence >= hoy` — uno vencido deja de bloquear; sin esto apartan 2029 gratis.
 * - `quoteId: null` — **el converso deja de contar**: en cuanto nació su
 *   cotización, la que bloquea es ella. Contando los dos, el evento convertido
 *   choocaría contra su propio apartado y no se podría ni guardar ni mover.
 *
 * El "hoy" se recibe para poder probar el vencimiento sin tocar el reloj, y por
 * defecto es el día civil de México — el mismo que usa el candado fiscal, porque
 * `vence` se guarda a medianoche UTC igual que las demás fechas civiles.
 */
function apartadosVivos(hoy: Date): Prisma.ApartadoFechaWhereInput {
  return { canceladoAt: null, quoteId: null, vence: { gte: hoy } };
}

/** Opciones que solo usan los caminos internos (conversión de apartado, pruebas). */
export interface AvailabilityOpts {
  /**
   * El apartado que se está convirtiendo. Su propia cotización no puede chocar
   * contra él: sin esta salida, convertir un apartado sería imposible porque el
   * apartado bloquea justo la fecha y el espacio que la cotización nueva pide.
   */
  excludeApartadoId?: string;
  /** El "hoy" con el que se mide el vencimiento de los apartados. */
  hoy?: Date;
}

/**
 * Disponibilidad por espacio+fecha. GLOBAL (no filtra por ventas): cualquiera
 * necesita ver si otra persona ya tiene esa fecha para no sobre-vender.
 */
export async function getAvailability(
  db: PrismaClient,
  fechaISO: string,
  spaceIds: string[],
  excludeQuoteId?: string,
  opts: AvailabilityOpts = {},
): Promise<{
  fecha: string;
  spaces: SpaceAvailability[];
  blocked: boolean;
  capillaEventos: CapillaEvento[];
}> {
  const range = dayRange(fechaISO);
  const hoy = opts.hoy ?? hoyCivilMexico();
  const [spaces, quotes, capillaQuotes, apartados] = await Promise.all([
    db.space.findMany({ where: { id: { in: spaceIds } } }),
    db.quote.findMany({
      where: {
        fechaEvento: range,
        spaceIds: { hasSome: spaceIds },
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
        deletedAt: null,
        ...(excludeQuoteId ? { id: { not: excludeQuoteId } } : {}),
      },
      include: { client: { select: { nombre: true } } },
    }),
    // Los apartados de banquetero bloquean igual que un evento comprometido: es
    // dinero real sobre una fecha.
    db.apartadoFecha.findMany({
      where: {
        fechaEvento: range,
        spaceIds: { hasSome: spaceIds },
        ...apartadosVivos(hoy),
        ...(opts.excludeApartadoId ? { id: { not: opts.excludeApartadoId } } : {}),
      },
      include: { banquetero: { select: { nombre: true } } },
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
    const apartadosDelEspacio = apartados.filter((a) => a.spaceIds.includes(spaceId));
    const counts = {
      cotizaciones: relevantes.filter((q) => COTIZACION.has(q.status)).length,
      formalizadas: relevantes.filter((q) => q.status === 'formalizada').length,
      complementadas: relevantes.filter((q) => q.status === 'complementada').length,
      liquidadas: relevantes.filter((q) => q.status === 'liquidada').length,
      apartados: apartadosDelEspacio.length,
    };
    let level: AvailabilityLevel = 'libre';
    if (relevantes.some((q) => BLOQUEO.has(q.status)) || apartadosDelEspacio.length > 0) {
      level = 'bloqueada';
    } else if (counts.cotizaciones > 0) level = 'cotizaciones';

    return {
      spaceId,
      nombre: nombreById.get(spaceId) ?? spaceId,
      level,
      counts,
      quotes: relevantes.map((q) => ({ id: q.id, cliente: q.client?.nombre ?? 'Cliente', status: q.status })),
      apartados: apartadosDelEspacio.map((a) => ({
        apartadoId: a.id,
        banquetero: a.banquetero?.nombre ?? 'Banquetero',
        venceISO: a.vence.toISOString(),
        deposito: a.deposito,
      })),
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

/**
 * Una fecha apartada, en la agenda. Va en su PROPIA lista y no dentro de
 * `events`: un apartado no tiene `quoteId`, ni cliente, ni estatus, y meterlo en
 * la lista de eventos obligaría a que todo lo que la consume (los chips, el
 * arrastre para mover fecha, el aviso de empalmes) tratara con eventos a medias.
 * Separado, la agenda lo pinta distinto — que es justo lo que se pidió.
 */
export interface AgendaApartado {
  apartadoId: string;
  /** Para que el chip de la agenda pueda abrir la ficha de su banquetero, que es
   *  donde el apartado se cancela o se convierte. Sin él el chip no lleva a nada. */
  banqueteroId: string;
  banquetero: string;
  fechaEvento: string;
  spaceIds: string[];
  venceISO: string;
  deposito: number;
  nota: string | null;
}

/** Eventos (todo lo que no está en la papelera) en un rango de fechas, para la agenda. */
export async function getAgenda(
  db: PrismaClient,
  fromISO: string,
  toISO: string,
  opts: { hoy?: Date } = {},
): Promise<{ events: AgendaEvent[]; apartados: AgendaApartado[] }> {
  const gte = new Date(`${fromISO}T00:00:00.000Z`);
  const lt = new Date(`${toISO}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1);
  const hoy = opts.hoy ?? hoyCivilMexico();
  const [quotes, apartados] = await Promise.all([
    db.quote.findMany({
      where: { fechaEvento: { gte, lt }, deletedAt: null },
      include: { client: { select: { nombre: true } }, eventType: { select: { nombre: true } } },
      orderBy: { fechaEvento: 'asc' },
    }),
    db.apartadoFecha.findMany({
      where: { fechaEvento: { gte, lt }, ...apartadosVivos(hoy) },
      include: { banquetero: { select: { nombre: true } } },
      orderBy: { fechaEvento: 'asc' },
    }),
  ]);
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
    apartados: apartados.map((a) => ({
      apartadoId: a.id,
      banqueteroId: a.banqueteroId,
      banquetero: a.banquetero?.nombre ?? 'Banquetero',
      fechaEvento: a.fechaEvento.toISOString(),
      spaceIds: a.spaceIds,
      venceISO: a.vence.toISOString(),
      deposito: a.deposito,
      nota: a.nota,
    })),
  };
}
