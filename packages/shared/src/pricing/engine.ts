import type {
  Catalog, QuoteSelection, QuoteBreakdown, QuoteLine,
} from '../types.js';
import { findBracket } from './brackets.js';
import { dayType } from './day-type.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeQuote(
  catalog: Catalog,
  sel: QuoteSelection,
): QuoteBreakdown {
  const dt = dayType(sel.fecha);
  const lines: QuoteLine[] = [];

  // 1. Renta (con IVA) — suma de espacios
  let rentaTotal = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = catalog.rentalPrices.filter((r) => r.spaceId === spaceId);
    const row = findBracket(rows, sel.invitados);
    if (!row) {
      throw new Error(
        `El espacio ${spaceId} no tiene rango de renta para ${sel.invitados} invitados`,
      );
    }
    const monto = row.prices[dt];
    rentaTotal += monto;
    lines.push({ concepto: `Renta ${spaceId}`, monto, ivaIncluido: true });
  }

  // 2. Horas extra (5% de renta por hora, con IVA porque es sobre la renta)
  if (sel.horasExtra > 0) {
    const monto = rentaTotal * catalog.extraHourRate * sel.horasExtra;
    rentaTotal += monto;
    lines.push({
      concepto: 'Horas extra',
      detalle: `${sel.horasExtra} × 5% renta`,
      monto,
      ivaIncluido: true,
    });
  }

  // 3. Alimentos (sin IVA en tabla => se agrega después) + descuento 5% renta
  let alimentosBase = 0;
  if (sel.foodPackageId) {
    const pkg = catalog.foodPackages.find((p) => p.id === sel.foodPackageId);
    if (!pkg) throw new Error(`Paquete de alimentos ${sel.foodPackageId} no existe`);
    const row = findBracket(pkg.brackets, sel.invitados);
    if (!row) {
      throw new Error(
        `El paquete ${pkg.name} no tiene rango para ${sel.invitados} invitados`,
      );
    }
    alimentosBase = row.pricePerPerson * sel.invitados;
    lines.push({
      concepto: `Alimentos ${pkg.name}`,
      detalle: `${sel.invitados} × ${row.pricePerPerson}`,
      monto: alimentosBase,
      ivaIncluido: pkg.ivaIncluded,
    });

    const descuento = rentaTotal * catalog.foodDiscountRate;
    rentaTotal -= descuento;
    lines.push({
      concepto: 'Descuento por alimentos (5% renta)',
      monto: -descuento,
      ivaIncluido: true,
    });
  }

  // 4. Add-ons (sin IVA => se agrega)
  let addonsBase = 0;
  for (const a of sel.addOns) {
    const addon = catalog.addOns.find((x) => x.id === a.addOnId);
    if (!addon) throw new Error(`Add-on ${a.addOnId} no existe`);
    let monto: number;
    if (addon.kind === 'fijo') monto = addon.price;
    else if (addon.kind === 'porPersona') monto = addon.price * sel.invitados;
    else monto = addon.price * a.cantidad; // porUnidad
    addonsBase += monto;
    lines.push({
      concepto: addon.name,
      detalle: addon.kind === 'fijo' ? undefined : `× ${addon.kind === 'porPersona' ? sel.invitados : a.cantidad}`,
      monto,
      ivaIncluido: false,
    });
  }

  // 5. Totales.
  // rentaTotal ya incluye IVA. Las bases sin IVA (alimentos, add-ons) reciben IVA.
  const baseSinIva = alimentosBase + addonsBase;
  const ivaSobreBases = baseSinIva * catalog.ivaRate;
  const total = round2(rentaTotal + baseSinIva + ivaSobreBases);

  return {
    lines,
    subtotal: round2(rentaTotal + baseSinIva),
    iva: round2(ivaSobreBases),
    total,
    rentaTotal: round2(rentaTotal),
  };
}
