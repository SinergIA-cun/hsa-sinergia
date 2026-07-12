import type { PrismaClient } from '@hsa/database';
import { ownershipWhere, loadEstadoCuentaBulk, expireStaleQuotes, type Actor } from '../quotes/service.js';
import type { Milestone } from '../quotes/estadoCuenta.js';

// Estatus con compromiso de pago (evento confirmado, aún genera cobros).
const CONFIRMADOS = ['apartada', 'formalizada'] as const;
// Estatus de evento real en el calendario (ya reservado).
const EVENTOS = ['apartada', 'formalizada', 'liquidada'] as const;
// Pipeline comercial: cotizaciones vivas sin reservar todavía.
const PIPELINE = ['borrador', 'enviada', 'aceptada'] as const;

export interface DashboardKpis {
  eventosMes: number;
  porCobrar: number;
  cobradoMes: number;
  cotizacionesActivas: number;
}

export interface VencimientoItem {
  quoteId: string;
  cliente: string;
  evento: string;
  hito: string;
  restante: number;
  venceISO: string;
  vencido: boolean;
}

export interface DesfaseItem {
  quoteId: string;
  cliente: string;
  evento: string;
  status: string;
  saldo: number;
}

export interface EventoItem {
  quoteId: string;
  cliente: string;
  evento: string;
  fechaEventoISO: string;
  status: string;
  saldo: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  vencimientos: VencimientoItem[];
  desfases: DesfaseItem[];
  proximosEventos: EventoItem[];
}

/** Rango [inicio, fin) del mes calendario de `ref` en UTC. */
function mesUTC(ref: Date): { desde: Date; hasta: Date } {
  const desde = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return { desde, hasta };
}

/** Primer día del día de hoy en UTC (medianoche), para comparar contra fechas de evento. */
function hoyUTC(ref: Date): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
}

/** El siguiente hito con fecha de vencimiento que aún no se cubre. */
function proximoHito(plan: Milestone[] | null): Milestone | null {
  if (!plan) return null;
  const pendientes = plan.filter((m) => m.venceISO && !m.completo && m.restante > 0);
  pendientes.sort((a, b) => (a.venceISO! < b.venceISO! ? -1 : 1));
  return pendientes[0] ?? null;
}

/**
 * Métricas del panel de inicio, respetando la propiedad por rol
 * (admin ve todo; ventas solo sus cotizaciones).
 */
export async function getDashboard(
  db: PrismaClient,
  actor: Actor,
  now: Date = new Date(),
): Promise<DashboardData> {
  await expireStaleQuotes(db, now); // vencimiento automático antes de agregar KPIs
  const where = { ...ownershipWhere(actor), deletedAt: null };
  const quotes = await db.quote.findMany({
    where,
    include: { client: true, eventType: true },
  });

  const quoteIds = quotes.map((q) => q.id);

  const [estados, payments] = await Promise.all([
    loadEstadoCuentaBulk(db, quotes),
    db.payment.findMany({
      where: { quoteId: { in: quoteIds } },
      select: { monto: true, anuladoAt: true, fecha: true },
    }),
  ]);

  const { desde, hasta } = mesUTC(now);
  const hoy = hoyUTC(now);

  let eventosMes = 0;
  let porCobrar = 0;
  let cotizacionesActivas = 0;
  const vencimientos: VencimientoItem[] = [];
  const desfases: DesfaseItem[] = [];
  const proximosEventos: EventoItem[] = [];

  for (const q of quotes) {
    const cliente = q.client?.nombre ?? 'Cliente';
    const evento = q.eventType?.nombre ?? 'Evento';
    const ec = estados.get(q.id)!;

    if ((PIPELINE as readonly string[]).includes(q.status)) cotizacionesActivas += 1;

    if ((EVENTOS as readonly string[]).includes(q.status)) {
      if (q.fechaEvento >= desde && q.fechaEvento < hasta) eventosMes += 1;
      if (q.fechaEvento >= hoy) {
        proximosEventos.push({
          quoteId: q.id,
          cliente,
          evento,
          fechaEventoISO: q.fechaEvento.toISOString(),
          status: q.status,
          saldo: ec.saldo,
        });
      }
    }

    if ((CONFIRMADOS as readonly string[]).includes(q.status)) {
      porCobrar += ec.saldo;

      const hito = proximoHito(ec.plan);
      if (hito && hito.venceISO) {
        vencimientos.push({
          quoteId: q.id,
          cliente,
          evento,
          hito: hito.label,
          restante: hito.restante,
          venceISO: hito.venceISO,
          vencido: new Date(hito.venceISO) < hoy,
        });
      }

      if (ec.desfase) {
        desfases.push({ quoteId: q.id, cliente, evento, status: q.status, saldo: ec.saldo });
      }
    }
  }

  // Cobrado este mes: pagos vigentes con fecha dentro del mes en curso.
  const cobradoMes = payments
    .filter((p) => p.anuladoAt == null && p.fecha >= desde && p.fecha < hasta)
    .reduce((s, p) => s + p.monto, 0);

  vencimientos.sort((a, b) => (a.venceISO < b.venceISO ? -1 : 1));
  proximosEventos.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? -1 : 1));

  return {
    kpis: { eventosMes, porCobrar, cobradoMes, cotizacionesActivas },
    vencimientos: vencimientos.slice(0, 8),
    desfases,
    proximosEventos: proximosEventos.slice(0, 6),
  };
}
