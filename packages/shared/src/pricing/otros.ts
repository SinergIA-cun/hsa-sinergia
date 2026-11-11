import type { QuoteBreakdown, QuoteLine } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

/**
 * Alimentos y servicios sobre un desglose congelado (11-nov-2026: "poder meter
 * un banquete o paquete de alimentos aunque el evento esté formalizado o
 * liquidado").
 *
 * Un evento con precio pactado (importado del BI, apartado con renta acordada)
 * o que ya pasó no se recotiza: su renta es un hecho. Pero lo que se le paga al
 * proveedor —el paquete de alimentos, los servicios— sí se agrega después. Aquí
 * la renta se queda tal cual y solo se cambian los renglones de alimentos y
 * servicios. El plan de pagos se mide sobre la renta, así que no se mueve.
 */

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * La selección con la que el motor calcula SOLO alimentos y servicios: sin
 * salones, capilla ni descuentos (son renta), y sin la promoción por alimentos
 * (se resta de la renta, y la renta congelada no se mueve).
 */
export function seleccionSoloOtros(sel: QuoteSelection): QuoteSelection {
  return {
    ...sel,
    spaceIds: [],
    usaCapilla: false,
    capillaMonto: undefined,
    descuentoPct: undefined,
    descuentoMonto: undefined,
    descuentoMotivo: undefined,
    descuentoAlimentosPct: 0,
  };
}

/** Un renglón de alimentos y servicios que viene del motor (no el pactado del BI). */
const esOtroCalculado = (l: QuoteLine) => l.grupo === 'otros' && l.ref?.tipo !== 'pactado';

/**
 * El desglose congelado con los alimentos y servicios de `calculado`.
 *
 * Se conservan del congelado: la renta completa (salones, descuentos, horas
 * extra, capilla, cargos del punto de venta) y el renglón `pactado` del BI
 * ("Alimentos y servicios" importado), que es lo que ya se vendió. Lo demás de
 * `otros` sale de `calculado`.
 */
export function conOtrosRecalculados(congelado: QuoteBreakdown, calculado: QuoteBreakdown, ivaRate: number): QuoteBreakdown {
  const otros = [
    ...congelado.lines.filter((l) => l.grupo === 'otros' && !esOtroCalculado(l)),
    ...calculado.lines.filter(esOtroCalculado),
  ];
  const lines = [...congelado.lines.filter((l) => l.grupo !== 'otros'), ...otros];
  const otrosTotal = r2(otros.reduce((s, l) => s + (l.ivaIncluido ? l.monto : l.monto * (1 + ivaRate)), 0));
  const otrosSubtotal = r2(otros.reduce((s, l) => s + (l.ivaIncluido ? l.monto / (1 + ivaRate) : l.monto), 0));
  const otrosIva = r2(otrosTotal - otrosSubtotal);
  const rentaTotal = congelado.rentaTotal;
  const rentaSubtotal = congelado.rentaSubtotal ?? r2(rentaTotal / (1 + ivaRate));
  const rentaIva = congelado.rentaIva ?? r2(rentaTotal - rentaSubtotal);
  return {
    ...congelado,
    lines,
    otrosTotal,
    otrosSubtotal,
    otrosIva,
    subtotal: r2(rentaSubtotal + otrosSubtotal),
    iva: r2(rentaIva + otrosIva),
    total: r2(rentaTotal + otrosTotal),
  };
}
