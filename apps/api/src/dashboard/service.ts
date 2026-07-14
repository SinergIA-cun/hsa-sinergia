import type { PrismaClient } from '@hsa/database';
import { ownershipWhere, loadEstadoCuentaBulk, expireStaleQuotes, type Actor } from '../quotes/service.js';

// Estatus de evento real (ya reservado) — para fichas, próxima semana y alertas.
const EVENTOS = ['apartada', 'formalizada', 'liquidada'] as const;
// Confirmados que aún deben dinero (para alertas de finiquito).
const CONFIRMADOS = ['apartada', 'formalizada'] as const;

export type Semaforo = 'verde' | 'amarillo' | 'rojo';

export interface FichaSemana {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  finiquitoISO: string | null;
  semaforo: Semaforo;
  faltantes: string[]; // campos de la hoja operativa que faltan
}

export interface EventoProxima {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  status: string;
  dia: 'viernes' | 'sabado' | 'domingo';
}

export interface AlertaFiniquito {
  quoteId: string;
  cliente: string;
  evento: string;
  fechaEventoISO: string;
  finiquitoISO: string | null;
  restante: number;
  diasVencido: number;
}

export interface DashboardData {
  kpis: { eventosMes: number };
  fichasSemana: FichaSemana[];
  proximaSemana: EventoProxima[];
  alertas: AlertaFiniquito[];
}

/** Medianoche de hoy en UTC (las fechas de evento se guardan en UTC medianoche). */
function hoyUTC(ref: Date): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
}

/** Rango [inicio, fin) del mes calendario de `ref` en UTC. */
function mesUTC(ref: Date): { desde: Date; hasta: Date } {
  return {
    desde: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)),
    hasta: new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1)),
  };
}

/** Semana en curso y la siguiente (lunes a lunes, UTC). */
function semanasUTC(ref: Date): { estaIni: Date; estaFin: Date; proxIni: Date; proxFin: Date } {
  const hoy = hoyUTC(ref);
  const desdeLunes = (hoy.getUTCDay() + 6) % 7; // 0=Lun … 6=Dom
  const estaIni = new Date(hoy);
  estaIni.setUTCDate(estaIni.getUTCDate() - desdeLunes);
  const estaFin = new Date(estaIni);
  estaFin.setUTCDate(estaFin.getUTCDate() + 7);
  const proxIni = new Date(estaFin);
  const proxFin = new Date(proxIni);
  proxFin.setUTCDate(proxFin.getUTCDate() + 7);
  return { estaIni, estaFin, proxIni, proxFin };
}

const DIA_FIN_DE_SEMANA: Record<number, EventoProxima['dia']> = { 5: 'viernes', 6: 'sabado', 0: 'domingo' };

function noVacio(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

// Campos mínimos para considerar la hoja operativa "lista" para operar el evento.
const REQUERIDOS_HOJA: { label: string; get: (q: QuoteRow) => unknown }[] = [
  { label: 'Festejado', get: (q) => hoja(q).nombreFestejado },
  { label: 'Banquetero', get: (q) => hoja(q).banquetero },
  { label: 'Personal HSA', get: (q) => hoja(q).personalHsa },
  { label: 'Hora inicio', get: (q) => q.horaInicio },
  { label: 'Hora término', get: (q) => q.horaTermino },
];

interface QuoteRow {
  id: string;
  status: string;
  fechaEvento: Date;
  spaceIds: string[];
  horaInicio: string | null;
  horaTermino: string | null;
  operativa: unknown;
  client: { nombre: string } | null;
  eventType: { nombre: string } | null;
}

function hoja(q: QuoteRow): Record<string, unknown> {
  return (q.operativa ?? {}) as Record<string, unknown>;
}

/**
 * Panel de inicio orientado a la operación semanal por evento.
 * Respeta la propiedad por rol (admin ve todo; ventas solo lo suyo).
 */
export async function getDashboard(
  db: PrismaClient,
  actor: Actor,
  now: Date = new Date(),
): Promise<DashboardData> {
  await expireStaleQuotes(db, now);

  const [quotes, spaces] = await Promise.all([
    db.quote.findMany({
      where: { ...ownershipWhere(actor), deletedAt: null },
      include: { client: { select: { nombre: true } }, eventType: { select: { nombre: true } } },
    }),
    db.space.findMany({ select: { id: true, nombre: true } }),
  ]);
  const estados = await loadEstadoCuentaBulk(db, quotes);
  const espacioById = new Map(spaces.map((s) => [s.id, s.nombre]));

  const { desde, hasta } = mesUTC(now);
  const { estaIni, estaFin, proxIni, proxFin } = semanasUTC(now);
  const hoy = hoyUTC(now);

  let eventosMes = 0;
  const fichasSemana: FichaSemana[] = [];
  const proximaSemana: EventoProxima[] = [];
  const alertas: AlertaFiniquito[] = [];

  for (const q of quotes as unknown as QuoteRow[]) {
    if (!(EVENTOS as readonly string[]).includes(q.status)) continue;

    const cliente = q.client?.nombre ?? 'Cliente';
    const evento = q.eventType?.nombre ?? 'Evento';
    const espacio = espacioById.get(q.spaceIds[0] ?? '') ?? '—';
    const ec = estados.get(q.id)!;

    if (q.fechaEvento >= desde && q.fechaEvento < hasta) eventosMes += 1;

    // Estado del finiquito (fecha, si está pagado, si venció).
    const fin = ec.plan?.find((m) => m.key === 'finiquito') ?? null;
    const finiquitoISO = fin?.venceISO ?? null;
    const finiquitoPagado = fin ? fin.completo : ec.saldo <= 0;
    const finiquitoVencido = Boolean(
      fin && !fin.completo && fin.venceISO && new Date(fin.venceISO) < hoy,
    );
    const restanteFin = fin ? fin.restante : Math.max(0, ec.saldo);

    // Ficha operativa de la semana en curso.
    if (q.fechaEvento >= estaIni && q.fechaEvento < estaFin) {
      const faltantes = REQUERIDOS_HOJA.filter((r) => !noVacio(r.get(q))).map((r) => r.label);
      const hojaVacia = faltantes.length === REQUERIDOS_HOJA.length;
      const hojaCompleta = faltantes.length === 0;
      let semaforo: Semaforo;
      if (finiquitoVencido || hojaVacia) semaforo = 'rojo';
      else if (hojaCompleta && finiquitoPagado) semaforo = 'verde';
      else semaforo = 'amarillo';
      fichasSemana.push({
        quoteId: q.id,
        cliente,
        evento,
        espacio,
        fechaEventoISO: q.fechaEvento.toISOString(),
        finiquitoISO,
        semaforo,
        faltantes,
      });
    }

    // Próxima semana: eventos del fin de semana (Vie/Sáb/Dom).
    if (q.fechaEvento >= proxIni && q.fechaEvento < proxFin) {
      const dia = DIA_FIN_DE_SEMANA[q.fechaEvento.getUTCDay()];
      if (dia) {
        proximaSemana.push({
          quoteId: q.id,
          cliente,
          evento,
          espacio,
          fechaEventoISO: q.fechaEvento.toISOString(),
          status: q.status,
          dia,
        });
      }
    }

    // Alertas: entró en sus 30 días (finiquito) y no finiquitó.
    if ((CONFIRMADOS as readonly string[]).includes(q.status) && finiquitoVencido) {
      const dias = fin?.venceISO
        ? Math.round((hoy.getTime() - new Date(fin.venceISO).getTime()) / 86_400_000)
        : 0;
      alertas.push({
        quoteId: q.id,
        cliente,
        evento,
        fechaEventoISO: q.fechaEvento.toISOString(),
        finiquitoISO,
        restante: restanteFin,
        diasVencido: dias,
      });
    }
  }

  fichasSemana.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? -1 : 1));
  proximaSemana.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? -1 : 1));
  alertas.sort((a, b) => b.diasVencido - a.diasVencido);

  return {
    kpis: { eventosMes },
    fichasSemana: fichasSemana.slice(0, 9),
    proximaSemana: proximaSemana.slice(0, 9),
    alertas,
  };
}
