export type PaymentStatus = 'formalizada' | 'complementada' | 'liquidada';

export interface SpaceRule {
  anticipo: number;
  complementoPct: number;
  liquidarDiasAntes: number;
}

/** Regla de un espacio junto con la renta base que aportó, para poder repartir
 *  el complemento en proporción cuando el evento usa más de un salón. */
export interface SpaceRuleWithRent {
  spaceId: string;
  rule: SpaceRule;
  rentaBase: number;
}

export interface PaymentLite {
  monto: number;
  anuladoAt: Date | null;
}

/** Un renglón del complemento: lo que aporta un salón, con su multiplicación a la vista. */
export interface ComplementoPorEspacio {
  spaceId: string;
  rentaBase: number;
  pct: number;
  monto: number;
}

export interface Milestone {
  key: 'apartar' | 'complemento' | 'finiquito';
  label: string;
  objetivo: number;
  cubierto: number;
  restante: number;
  completo: boolean;
  venceISO: string | null;
  /** Solo el complemento: qué aporta cada salón. `pct × rentaBase == monto`, exacto. */
  desglose?: ComplementoPorEspacio[];
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
const RANK: Record<PaymentStatus, number> = { formalizada: 1, complementada: 2, liquidada: 3 };

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
  rules: SpaceRuleWithRent[] | null;
  payments: PaymentLite[];
  fechaApartado?: Date | null;
  now?: Date;
}): EstadoCuenta {
  const { total, fechaEvento, status, rules, payments, fechaApartado } = args;
  const pagado = payments.filter((p) => p.anuladoAt == null).reduce((s, p) => s + p.monto, 0);
  const saldo = total - pagado;

  if (!rules || rules.length === 0) {
    return { total, pagado, saldo, plan: null, planPendiente: true, sugerido: null, desfase: false };
  }

  // Anticipo: cada espacio aporta el suyo (sección H del contrato, por espacio).
  const objApartar = rules.reduce((s, r) => s + r.rule.anticipo, 0);

  // Complemento: cada salón aporta el porcentaje de SU renta. La renta que se le
  // pasa aquí ya viene prorrateada (incluye su parte de horas extra y capilla),
  // así que la suma de los renglones es idéntica al viejo `pctPonderado × total`
  // pero cada renglón multiplica exacto y se puede imprimir en el contrato.
  const desglose: ComplementoPorEspacio[] = rules.map((r) => ({
    spaceId: r.spaceId,
    rentaBase: r.rentaBase,
    pct: r.rule.complementoPct,
    monto: Math.round(r.rule.complementoPct * r.rentaBase),
  }));
  const objComplemento = objApartar + desglose.reduce((s, d) => s + d.monto, 0);
  const objFiniquito = total;

  // El finiquito más exigente manda cuando los espacios difieren.
  const liquidarDiasAntes = Math.max(...rules.map((r) => r.rule.liquidarDiasAntes));

  const finiquitoVence = minusDays(fechaEvento, liquidarDiasAntes);
  // Complemento: 3 meses después del anticipo, PERO nunca después del finiquito
  // (para eventos próximos, +3 meses caería después del evento). Se tope al finiquito.
  let complementoVence: Date | null = null;
  if (fechaApartado) {
    const tresMeses = addMonths(fechaApartado, 3);
    complementoVence = tresMeses < finiquitoVence ? tresMeses : finiquitoVence;
  }

  const hito = (
    key: Milestone['key'],
    label: string,
    objetivo: number,
    venceISO: string | null,
    desgloseHito?: ComplementoPorEspacio[],
  ): Milestone => {
    const cubierto = Math.min(pagado, objetivo);
    return { key, label, objetivo, cubierto, restante: Math.max(0, objetivo - cubierto), completo: pagado >= objetivo, venceISO, desglose: desgloseHito };
  };

  const plan: Milestone[] = [
    hito('apartar', 'Apartar fecha', objApartar, null),
    hito('complemento', 'Complemento', objComplemento, complementoVence?.toISOString() ?? null, desglose),
    hito('finiquito', 'Finiquito', objFiniquito, finiquitoVence.toISOString()),
  ];

  let sugerido: PaymentStatus | null = null;
  if (pagado >= objFiniquito) sugerido = 'liquidada';
  else if (pagado >= objComplemento) sugerido = 'complementada';
  else if (pagado >= objApartar) sugerido = 'formalizada';

  // Desfase: el estatus actual exige un umbral que el pagado ya no cubre.
  let desfase = false;
  if (status in RANK) {
    const req = RANK[status as PaymentStatus];
    if (req >= RANK.formalizada && pagado < objApartar) desfase = true;
    if (req >= RANK.complementada && pagado < objComplemento) desfase = true;
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
