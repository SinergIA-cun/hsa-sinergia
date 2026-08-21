import type { PrismaClient } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { ownershipWhere, loadEstadoCuentaBulk, type Actor } from '../quotes/service.js';
import {
  resumenBanqueteros,
  type ApartadoPendiente,
  type ResumenBanquetero,
} from '../banqueteros/resumen.js';
import { DIAS_POR_VENCER } from '../banqueteros/estadoCuenta.js';

// Estatus de evento real (ya reservado) — para fichas, próxima semana y alertas.
const EVENTOS = ['formalizada', 'complementada', 'liquidada'] as const;
// Confirmados que aún deben dinero (para alertas de finiquito).
const CONFIRMADOS = ['formalizada', 'complementada'] as const;

export type Semaforo = 'verde' | 'amarillo' | 'rojo';

// Política de la hacienda: el finiquito vence 30 días antes del evento.
const DIAS_FINIQUITO = 30;

export interface FiniquitoFicha {
  venceISO: string;
  pagado: boolean;
  pendiente: boolean; // entró en su ventana de 30 días y aún debe
  restante: number;
  planPendiente: boolean; // el espacio no tiene regla de pago definida
}

/** Datos operativos de la hoja (el JSON `operativa`), planos para la ficha. */
export interface HojaFicha {
  nombreFestejado: string | null;
  relacionCliente: string | null;
  horaMisa: string | null;
  fotografia: boolean;
  banquetero: string | null;
  banqueteroPaqHsa: boolean;
  estrado: string | null;
  pista: string | null;
  personalHsa: string | null;
  personalSeguridadHora: string | null;
  personalSeguridadElementos: number | null;
  limpiezaNocturna: boolean;
  habitacion: string | null;
  seQuedaEquipo: string | null;
  maniobras: boolean;
  anotaciones: string | null;
}

export interface FichaSemana {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  semaforo: Semaforo;
  faltantes: string[]; // campos de la hoja operativa que faltan
  // Datos para armar la ficha operativa completa (como el PDF semanal):
  invitados: number;
  horasEvento: number | null;
  usaCapilla: boolean;
  capillaHorario: string | null;
  costoHoraExtra: number;
  horaInicio: string | null;
  horaTermino: string | null;
  horarioCivil: string | null;
  hoja: HojaFicha;
  finiquito: FiniquitoFicha;
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

/**
 * Un evento que YA PASÓ y sigue debiendo.
 *
 * Por la regla del negocio —"no hay forma de hacer el evento si no está
 * pagado"— **no debería existir ninguno**. Si existe, o no se capturó un pago o
 * el evento no se hizo. Va como alerta con nombre y fecha, no como un número
 * silencioso: es lo único del panel que dice "aquí hay un error de captura o un
 * cobro perdido", y nadie lo puede ver hoy.
 *
 * Sí, todos aparecen también en `alertas` (un evento pasado ya rebasó su ventana
 * de finiquito de 30 días). No es lo mismo: "finiquito vencido" es un cobro por
 * hacer y "el evento ya pasó sin pagarse" es un hecho que no se puede cobrar
 * después. La interfaz los saca de la lista de finiquito para no listar el mismo
 * evento dos veces con dos urgencias distintas.
 */
export interface EventoPasadoSinLiquidar {
  quoteId: string;
  cliente: string;
  evento: string;
  espacio: string;
  fechaEventoISO: string;
  status: string;
  restante: number;
  diasDesdeEvento: number;
}

/** Lo que el panel dice de la cartera de banqueteros. */
export interface BanqueterosDashboard {
  /** Σ de todos los saldos sin asignar. Dinero de la hacienda sin destino. */
  totalSinAsignar: number;
  /** Solo los que traen saldo, del mayor al menor: los demás no son noticia. */
  saldos: ResumenBanquetero[];
  /** Fechas apartadas sin convertir, del vencimiento más próximo al más lejano. */
  apartados: ApartadoPendiente[];
  /** Cuántos de esos vencen dentro de los próximos 30 días. */
  porVencer: number;
}

export interface DashboardData {
  kpis: { eventosMes: number };
  fichasSemana: FichaSemana[];
  proximaSemana: EventoProxima[];
  alertas: AlertaFiniquito[];
  /**
   * Los eventos pasados sin liquidar. Aparte de `alertas` a propósito: ver el
   * comentario de `EventoPasadoSinLiquidar`.
   */
  pasadosSinLiquidar: EventoPasadoSinLiquidar[];
  /**
   * La cartera de banqueteros. **Global, no filtrada por pertenencia**: el saldo
   * sin asignar es dinero que la hacienda tiene en la mano, no una cifra de
   * ventas de nadie, y "el saldo de lo mío" no cuadraría contra el banco. Es la
   * misma razón por la que `getAvailability` es global.
   */
  banqueteros: BanqueterosDashboard;
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
  // El festejado y el banquetero ahora se pueden capturar al COTIZAR (columnas del
  // evento); la hoja operativa sigue valiendo como respaldo de los eventos
  // anteriores a esos campos. Si no se mirara la columna, un evento capturado en el
  // formulario aparecería como "falta Festejado" y la ficha semanal saldría vacía.
  { label: 'Festejado', get: (q) => q.festejado ?? hoja(q).nombreFestejado },
  { label: 'Banquetero', get: (q) => q.banquetero?.nombre ?? hoja(q).banquetero },
  { label: 'Personal HSA', get: (q) => hoja(q).personalHsa },
  { label: 'Hora inicio', get: (q) => q.horaInicio },
  { label: 'Hora término', get: (q) => q.horaTermino },
];

interface QuoteRow {
  id: string;
  status: string;
  fechaEvento: Date;
  spaceIds: string[];
  invitados: number;
  horasEvento: number | null;
  usaCapilla: boolean;
  capillaHorario: string | null;
  rentaTotal: number;
  horaInicio: string | null;
  horaTermino: string | null;
  horarioCivil: string | null;
  operativa: unknown;
  festejado: string | null;
  banquetero: { nombre: string } | null;
  client: { nombre: string } | null;
  eventType: { nombre: string } | null;
}

function hoja(q: QuoteRow): Record<string, unknown> {
  return (q.operativa ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return noVacio(v) ? String(v) : null;
}

/** Aplana el JSON `operativa` a los campos de la ficha. */
function toHojaFicha(q: QuoteRow): HojaFicha {
  const h = hoja(q);
  return {
    nombreFestejado: str(q.festejado ?? h.nombreFestejado),
    relacionCliente: str(h.relacionCliente),
    horaMisa: str(h.horaMisa),
    fotografia: h.fotografia === true,
    banquetero: str(q.banquetero?.nombre ?? h.banquetero),
    banqueteroPaqHsa: h.banqueteroPaqHsa === true,
    estrado: str(h.estrado),
    pista: str(h.pista),
    personalHsa: str(h.personalHsa),
    personalSeguridadHora: str(h.personalSeguridadHora),
    personalSeguridadElementos:
      typeof h.personalSeguridadElementos === 'number' ? h.personalSeguridadElementos : null,
    limpiezaNocturna: h.limpiezaNocturna === true,
    habitacion: str(h.habitacion),
    seQuedaEquipo: str(h.seQuedaEquipo),
    maniobras: !!h.maniobras,
    anotaciones: str(h.anotaciones),
  };
}

/** Fecha ISO = fecha del evento menos N días (UTC). */
function isoMenosDias(fecha: Date, dias: number): string {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString();
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
  // El vencimiento de los apartados se mide con el día civil de MÉXICO, no con
  // `hoyUTC`: es el mismo "hoy" que usan `getAvailability` y la agenda. Con dos
  // relojes distintos el panel podría declarar muerto un apartado que la agenda
  // sigue pintando y que sigue bloqueando su fecha.
  const [quotes, spaces, cartera] = await Promise.all([
    db.quote.findMany({
      where: { ...ownershipWhere(actor), deletedAt: null },
      include: {
        client: { select: { nombre: true } },
        eventType: { select: { nombre: true } },
        banquetero: { select: { nombre: true } },
      },
    }),
    db.space.findMany({ select: { id: true, nombre: true } }),
    resumenBanqueteros(db, { hoy: hoyCivilMexico(now) }),
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
  const pasadosSinLiquidar: EventoPasadoSinLiquidar[] = [];

  for (const q of quotes as unknown as QuoteRow[]) {
    if (!(EVENTOS as readonly string[]).includes(q.status)) continue;

    const cliente = q.client?.nombre ?? 'Cliente';
    const evento = q.eventType?.nombre ?? 'Evento';
    // Un evento puede ocupar hasta 3 salones: se listan todos.
    const espacio = q.spaceIds.map((id) => espacioById.get(id) ?? id).join(' y ') || '—';
    const ec = estados.get(q.id)!;

    if (q.fechaEvento >= desde && q.fechaEvento < hasta) eventosMes += 1;

    // Finiquito ROBUSTO: no depende de que el espacio tenga regla de pago.
    // Vence 30 días antes del evento (o la fecha del plan si existe). Se considera
    // pendiente cuando ya entró en esa ventana y el saldo sigue > 0.
    const finPlan = ec.plan?.find((m) => m.key === 'finiquito') ?? null;
    const finVenceISO = finPlan?.venceISO ?? isoMenosDias(q.fechaEvento, DIAS_FINIQUITO);
    const finPagado = ec.saldo <= 0;
    const finiquito: FiniquitoFicha = {
      venceISO: finVenceISO,
      pagado: finPagado,
      pendiente: !finPagado && new Date(finVenceISO) <= hoy,
      restante: Math.max(0, ec.saldo),
      planPendiente: ec.planPendiente,
    };

    // Ficha operativa de la semana en curso.
    if (q.fechaEvento >= estaIni && q.fechaEvento < estaFin) {
      const faltantes = REQUERIDOS_HOJA.filter((r) => !noVacio(r.get(q))).map((r) => r.label);
      const hojaVacia = faltantes.length === REQUERIDOS_HOJA.length;
      // La hora de misa sólo se exige cuando el evento usa la capilla.
      if (q.usaCapilla && !noVacio(hoja(q).horaMisa)) faltantes.push('Hora misa');
      const hojaCompleta = faltantes.length === 0;
      let semaforo: Semaforo;
      if (finiquito.pendiente || hojaVacia) semaforo = 'rojo';
      else if (hojaCompleta && finiquito.pagado) semaforo = 'verde';
      else semaforo = 'amarillo';
      fichasSemana.push({
        quoteId: q.id,
        cliente,
        evento,
        espacio,
        fechaEventoISO: q.fechaEvento.toISOString(),
        semaforo,
        faltantes,
        invitados: q.invitados,
        horasEvento: q.horasEvento,
        usaCapilla: q.usaCapilla,
        capillaHorario: q.capillaHorario,
        costoHoraExtra: Math.round(q.rentaTotal * 0.05),
        horaInicio: q.horaInicio,
        horaTermino: q.horaTermino,
        horarioCivil: q.horarioCivil,
        hoja: toHojaFicha(q),
        finiquito,
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

    // El evento YA PASÓ y sigue debiendo. No debería existir ninguno: o no se
    // capturó un pago o el evento no se hizo. Incluye a las `liquidada` con saldo
    // —el total subió después de liquidar— porque ahí el dinero también falta.
    if (q.fechaEvento < hoy && ec.saldo > 0) {
      pasadosSinLiquidar.push({
        quoteId: q.id,
        cliente,
        evento,
        espacio,
        fechaEventoISO: q.fechaEvento.toISOString(),
        status: q.status,
        restante: ec.saldo,
        diasDesdeEvento: Math.round((hoy.getTime() - q.fechaEvento.getTime()) / 86_400_000),
      });
    }

    // Alertas: confirmado (formalizada/complementada) que ya entró en sus 30 días sin finiquitar.
    if ((CONFIRMADOS as readonly string[]).includes(q.status) && finiquito.pendiente) {
      const dias = Math.round((hoy.getTime() - new Date(finiquito.venceISO).getTime()) / 86_400_000);
      alertas.push({
        quoteId: q.id,
        cliente,
        evento,
        fechaEventoISO: q.fechaEvento.toISOString(),
        finiquitoISO: finiquito.venceISO,
        restante: finiquito.restante,
        diasVencido: dias,
      });
    }
  }

  fichasSemana.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? -1 : 1));
  proximaSemana.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? -1 : 1));
  alertas.sort((a, b) => b.diasVencido - a.diasVencido);
  // Del más reciente al más viejo: el del sábado pasado es el que alguien todavía
  // recuerda y puede corregir hoy.
  pasadosSinLiquidar.sort((a, b) => (a.fechaEventoISO < b.fechaEventoISO ? 1 : -1));

  const limitePorVencer = new Date(hoyCivilMexico(now));
  limitePorVencer.setUTCDate(limitePorVencer.getUTCDate() + DIAS_POR_VENCER);

  return {
    kpis: { eventosMes },
    fichasSemana: fichasSemana.slice(0, 9),
    proximaSemana: proximaSemana.slice(0, 9),
    alertas,
    pasadosSinLiquidar,
    banqueteros: {
      totalSinAsignar: cartera.totalSinAsignar,
      // Solo los que traen saldo: un banquetero con la cuenta en ceros no es
      // noticia y llenaría la alerta de ruido.
      saldos: cartera.banqueteros
        .filter((b) => b.saldoSinAsignar > 0)
        .sort((a, b) => b.saldoSinAsignar - a.saldoSinAsignar),
      apartados: cartera.apartados,
      porVencer: cartera.apartados.filter(
        (a) => new Date(a.venceISO).getTime() <= limitePorVencer.getTime(),
      ).length,
    },
  };
}
