import type { QuoteBreakdown, QuoteLine } from '../types.js';

/*
 * Importar del BI los eventos que ya estaban vendidos antes del sistema.
 *
 * Sin corte de fecha: "que pueda subir lo que sea" (el dueño, 5-oct-2026). Un
 * evento que todavía no se celebra entra como evento normal; uno que ya pasó
 * entra igual y queda archivado en el Histórico, donde se le pueden cargar
 * horas extra, multas, etc.
 */

/**
 * Nombre comparable: sin acentos, sin mayúsculas y sin las palabras que cada
 * sistema pone distinto ("Jardín La Cúpula" = "Cúpula" = "LA CUPULA").
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !['jardin', 'salon', 'la', 'las', 'los', 'el', 'de', 'del'].includes(p))
    .join(' ');
}

/**
 * El registro cuyo nombre coincide, o `null`. Solo cuenta una coincidencia
 * EXACTA tras normalizar: adivinar entre dos parecidos es justo el error que
 * luego nadie encuentra, así que ante la duda no se empareja y se reporta.
 */
export function emparejarNombre<T extends { nombre: string; slug?: string | null }>(
  buscado: string,
  opciones: readonly T[],
): T | null {
  const n = normalizarNombre(buscado);
  if (!n) return null;
  const hits = opciones.filter(
    (o) => normalizarNombre(o.nombre) === n || (o.slug != null && normalizarNombre(o.slug) === n),
  );
  return hits.length === 1 ? hits[0]! : null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * El desglose de un evento importado: su precio PACTADO, no uno calculado.
 *
 * El BI dice cuánto se vendió la renta y cuánto los alimentos; el catálogo de
 * hoy no tiene por qué dar lo mismo, y recotizar un evento ya vendido sería
 * cambiarle el precio al cliente. Así que se arma con los montos del BI, en la
 * forma que el resto del sistema lee (renglones de renta por salón con su
 * `spaceId`, que es lo que usa el plan de pagos).
 *
 * Con varios salones la renta se reparte en partes iguales —el BI no dice cuánto
 * fue de cada uno— y el último absorbe el redondeo, para que la suma sea exacta.
 *
 * Sin salón (un evento solo de capilla, una sesión de fotos) la renta va en un
 * solo renglón con el nombre de lo que se rentó (`sinSalon`) y sin `spaceId`:
 * no hay plan de pagos por salón que colgarle.
 */
export function desgloseImportado(args: {
  salones: { spaceId: string; nombre: string }[];
  rentaTotal: number;
  otrosTotal: number;
  ivaRate: number;
  sinSalon?: string;
}): QuoteBreakdown {
  const { salones, rentaTotal, otrosTotal, ivaRate } = args;
  if (salones.length === 0) {
    return armarDesglose(
      [{ concepto: `Renta ${args.sinSalon ?? 'del evento'}`, detalle: 'Precio pactado (importado del BI)', monto: rentaTotal, ivaIncluido: true, grupo: 'renta' }],
      { rentaTotal, otrosTotal, ivaRate },
    );
  }
  const parte = Math.floor(rentaTotal / salones.length);
  const lines: QuoteLine[] = salones.map((s, i) => ({
    concepto: `Renta ${s.nombre}`,
    detalle: 'Precio pactado (importado del BI)',
    monto: i === salones.length - 1 ? rentaTotal - parte * (salones.length - 1) : parte,
    ivaIncluido: true,
    grupo: 'renta',
    spaceId: s.spaceId,
  }));
  return armarDesglose(lines, { rentaTotal, otrosTotal, ivaRate });
}

function armarDesglose(
  rentaLines: QuoteLine[],
  { rentaTotal, otrosTotal, ivaRate }: { rentaTotal: number; otrosTotal: number; ivaRate: number },
): QuoteBreakdown {
  const lines = [...rentaLines];
  if (otrosTotal > 0) {
    lines.push({
      concepto: 'Alimentos y servicios',
      detalle: 'Precio pactado (importado del BI)',
      monto: otrosTotal,
      ivaIncluido: true,
      grupo: 'otros',
    });
  }
  const rentaSubtotal = r2(rentaTotal / (1 + ivaRate));
  const otrosSubtotal = r2(otrosTotal / (1 + ivaRate));
  return {
    lines,
    subtotal: r2(rentaSubtotal + otrosSubtotal),
    iva: r2(rentaTotal + otrosTotal - rentaSubtotal - otrosSubtotal),
    total: rentaTotal + otrosTotal,
    rentaSubtotal,
    rentaIva: r2(rentaTotal - rentaSubtotal),
    rentaTotal,
    otrosSubtotal,
    otrosIva: r2(otrosTotal - otrosSubtotal),
    otrosTotal,
  };
}

/** Lo que se compara de un evento, del lado del BI y del lado de la hacienda. */
export interface EventoComparable {
  fechaEvento: string;
  spaceIds: string[];
  invitados: number;
  eventTypeId: string | null;
  rentaTotal: number;
  /** Lo pagado a la renta, sin anulados. */
  pagado: number;
  /** Folios de los pagos, sin anulados. */
  folios: number[];
  /** ¿Usa la capilla? Solo se compara si el BI lo manda. */
  usaCapilla?: boolean;
}

export interface Diferencia {
  campo: 'fechaEvento' | 'salones' | 'invitados' | 'tipoEvento' | 'rentaTotal' | 'pagado' | 'folios' | 'usaCapilla';
  bi: unknown;
  hsa: unknown;
}

/**
 * En qué no cuadran los dos sistemas.
 *
 * Los folios se comparan como conjuntos y se reportan de los dos lados: un pago
 * que el BI tiene y la hacienda no (se perdió al capturar), y uno que la hacienda
 * tiene y el BI no.
 *
 * Ojo con la ventana: el BI tiene pagos hasta agosto, así que un pago de
 * septiembre que solo esté en la hacienda es lo esperado. Quien llama tiene que
 * pasar del lado de la hacienda SOLO los pagos hasta la fecha de corte del BI;
 * si no, todo evento con un pago reciente saldría "descuadrado".
 */
export function compararEvento(bi: EventoComparable, hsa: EventoComparable): Diferencia[] {
  const d: Diferencia[] = [];
  if (bi.fechaEvento !== hsa.fechaEvento) d.push({ campo: 'fechaEvento', bi: bi.fechaEvento, hsa: hsa.fechaEvento });
  const a = [...bi.spaceIds].sort();
  const b = [...hsa.spaceIds].sort();
  if (a.join() !== b.join()) d.push({ campo: 'salones', bi: a, hsa: b });
  if (bi.invitados !== hsa.invitados) d.push({ campo: 'invitados', bi: bi.invitados, hsa: hsa.invitados });
  if (bi.eventTypeId && bi.eventTypeId !== hsa.eventTypeId) {
    d.push({ campo: 'tipoEvento', bi: bi.eventTypeId, hsa: hsa.eventTypeId });
  }
  if (bi.rentaTotal !== hsa.rentaTotal) d.push({ campo: 'rentaTotal', bi: bi.rentaTotal, hsa: hsa.rentaTotal });
  if (bi.pagado !== hsa.pagado) d.push({ campo: 'pagado', bi: bi.pagado, hsa: hsa.pagado });
  const fb = new Set(bi.folios);
  const fh = new Set(hsa.folios);
  const soloBi = [...fb].filter((f) => !fh.has(f)).sort((x, y) => x - y);
  const soloHsa = [...fh].filter((f) => !fb.has(f)).sort((x, y) => x - y);
  if (soloBi.length || soloHsa.length) d.push({ campo: 'folios', bi: soloBi, hsa: soloHsa });
  if (bi.usaCapilla != null && bi.usaCapilla !== (hsa.usaCapilla ?? false)) {
    d.push({ campo: 'usaCapilla', bi: bi.usaCapilla, hsa: hsa.usaCapilla ?? false });
  }
  return d;
}
