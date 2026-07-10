export type PaymentStatus = 'apartada' | 'formalizada' | 'liquidada';

export interface SpaceRule {
  anticipo: number;
  complementoPct: number;
  liquidarDiasAntes: number;
}

export interface PaymentLite {
  monto: number;
  anuladoAt: Date | null;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  restante: number;
  completo: boolean;
  venceISO: string | null;
  porcentaje?: number; // solo el complemento: % sobre el total
}

export interface EstadoCuenta {
  total: number;
  pagado: number;
  saldo: number;
  plan: Milestone[] | null;
  planPendiente: boolean;
  sugerido: PaymentStatus | null;
  desfase: boolean;
}

// Orden de los estatus con umbral de pago.
const RANK: Record<PaymentStatus, number> = { apartada: 1, formalizada: 2, liquidada: 3 };

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}
function minusDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - days);
  return r;
}

export function computeEstadoCuenta(args: {
  total: number;
  fechaEvento: Date;
  status: string;
  rule: SpaceRule | null;
  payments: PaymentLite[];
  fechaApartado?: Date | null;
  now?: Date;
}): EstadoCuenta {
  const { total, fechaEvento, status, rule, payments, fechaApartado } = args;
  const pagado = payments.filter((p) => p.anuladoAt == null).reduce((s, p) => s + p.monto, 0);
  const saldo = total - pagado;

  if (!rule) {
    return { total, pagado, saldo, plan: null, planPendiente: true, sugerido: null, desfase: false };
  }

  const objApartar = rule.anticipo;
  const objComplemento = rule.anticipo + Math.round(rule.complementoPct * total);
  const objFiniquito = total;

  const complementoVence = fechaApartado ? addMonths(fechaApartado, 3) : null;
  const finiquitoVence = minusDays(fechaEvento, rule.liquidarDiasAntes);

  const hito = (
    key: Milestone['key'],
    label: string,
    objetivo: number,
    venceISO: string | null,
    porcentaje?: number,
  ): Milestone => {
    const cubierto = Math.min(pagado, objetivo);
    return { key, label, objetivo, cubierto, restante: Math.max(0, objetivo - cubierto), completo: pagado >= objetivo, venceISO, porcentaje };
  };

  const plan: Milestone[] = [
    hito('apartar', 'Apartar fecha', objApartar, null),
    hito('complemento', 'Complemento (formalizar)', objComplemento, complementoVence?.toISOString() ?? null, Math.round(rule.complementoPct * 100)),
    hito('finiquito', 'Finiquito', objFiniquito, finiquitoVence.toISOString()),
  ];

  let sugerido: PaymentStatus | null = null;
  if (pagado >= objFiniquito) sugerido = 'liquidada';
  else if (pagado >= objComplemento) sugerido = 'formalizada';
  else if (pagado >= objApartar) sugerido = 'apartada';

  // Desfase: el estatus actual exige un umbral que el pagado ya no cubre.
  let desfase = false;
  if (status in RANK) {
    const req = RANK[status as PaymentStatus];
    if (req >= RANK.apartada && pagado < objApartar) desfase = true;
    if (req >= RANK.formalizada && pagado < objComplemento) desfase = true;
    if (req >= RANK.liquidada && pagado < objFiniquito) desfase = true;
  }

  return { total, pagado, saldo, plan, planPendiente: false, sugerido, desfase };
}

/** ¿`sugerido` está más adelante que el estatus actual? (para proponer avanzar) */
export function esUpgrade(actual: string, sugerido: PaymentStatus | null): boolean {
  if (!sugerido) return false;
  const actualRank = actual in RANK ? RANK[actual as PaymentStatus] : 0;
  return RANK[sugerido] > actualRank;
}
