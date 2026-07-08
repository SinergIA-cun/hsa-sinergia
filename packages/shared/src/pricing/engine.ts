import type { Catalog, QuoteBreakdown, QuoteLine } from '../types.js';
import type { QuoteSelection } from '../schemas.js';
import { findBracket } from './brackets.js';
import { dayType } from './day-type.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Motor de precios (función pura). Recibe el catálogo y las selecciones y
 * devuelve el desglose congelado. Reglas:
 * - Renta: precio(espacio, rango, tipoDía), CON IVA ya incluido; suma de espacios.
 * - Horas extra: 5% de la renta de espacios (base) por hora.
 * - Descuento por alimentos: 5% de la renta de espacios (base). Horas extra y
 *   descuento se calculan sobre la MISMA base (espacios), no se componen entre sí.
 * - Alimentos: precio por persona × invitados. Si el paquete NO trae IVA, se le agrega.
 * - Add-ons: fijo | porPersona (× invitados) | porUnidad (× cantidad). SIN IVA => se agrega.
 * - `subtotal` es genuinamente pre-IVA y `iva` es el impuesto total; `subtotal + iva == total`.
 *   Es un desglose interno para el plan de pagos, no un desglose fiscal/CFDI.
 */
export function computeQuote(
  catalog: Catalog,
  sel: QuoteSelection,
): QuoteBreakdown {
  const dt = dayType(sel.fecha);
  const lines: QuoteLine[] = [];

  // 1. Renta de espacios (con IVA) — suma de espacios. Base para 5% y horas extra.
  let rentaEspacios = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = catalog.rentalPrices.filter((r) => r.spaceId === spaceId);
    const row = findBracket(rows, sel.invitados);
    if (!row) {
      throw new Error(
        `El espacio ${spaceId} no tiene rango de renta para ${sel.invitados} invitados`,
      );
    }
    const monto = row.prices[dt];
    if (monto == null) {
      throw new Error(`Falta precio para el espacio ${spaceId} en día ${dt}`);
    }
    rentaEspacios += monto;
    lines.push({ concepto: `Renta ${spaceId}`, monto: round2(monto), ivaIncluido: true });
  }

  // 2. Horas extra (5% de la renta de espacios por hora, con IVA porque es sobre la renta).
  let rentaConIva = rentaEspacios;
  if (sel.horasExtra > 0) {
    const monto = rentaEspacios * catalog.extraHourRate * sel.horasExtra;
    rentaConIva += monto;
    lines.push({
      concepto: 'Horas extra',
      detalle: `${sel.horasExtra} × 5% renta`,
      monto: round2(monto),
      ivaIncluido: true,
    });
  }

  // 3. Alimentos + descuento 5% (sobre la renta de espacios base, no sobre horas extra).
  let alimentosBaseSinIva = 0; // porción que aún NO trae IVA
  let alimentosConIva = 0; // porción que YA trae IVA (paquete ivaIncluido=true)
  if (sel.foodPackageId) {
    const pkg = catalog.foodPackages.find((p) => p.id === sel.foodPackageId);
    if (!pkg) throw new Error(`Paquete de alimentos ${sel.foodPackageId} no existe`);
    const row = findBracket(pkg.brackets, sel.invitados);
    if (!row) {
      throw new Error(
        `El paquete ${pkg.name} no tiene rango para ${sel.invitados} invitados`,
      );
    }
    const monto = row.pricePerPerson * sel.invitados;
    if (pkg.ivaIncluded) alimentosConIva += monto;
    else alimentosBaseSinIva += monto;
    lines.push({
      concepto: `Alimentos ${pkg.name}`,
      detalle: `${sel.invitados} × ${row.pricePerPerson}`,
      monto: round2(monto),
      ivaIncluido: pkg.ivaIncluded,
    });

    const descuento = rentaEspacios * catalog.foodDiscountRate;
    rentaConIva -= descuento;
    lines.push({
      concepto: 'Descuento por alimentos (5% renta)',
      monto: round2(-descuento),
      ivaIncluido: true,
    });
  }

  // 4. Add-ons (sin IVA => se agrega).
  let addonsBaseSinIva = 0;
  for (const a of sel.addOns) {
    const addon = catalog.addOns.find((x) => x.id === a.addOnId);
    if (!addon) throw new Error(`Add-on ${a.addOnId} no existe`);
    // fijo: precio tal cual. porPersona: × invitados (ignora cantidad). porUnidad: × cantidad.
    let monto: number;
    if (addon.kind === 'fijo') monto = addon.price;
    else if (addon.kind === 'porPersona') monto = addon.price * sel.invitados;
    else monto = addon.price * a.cantidad;
    addonsBaseSinIva += monto;
    lines.push({
      concepto: addon.name,
      detalle:
        addon.kind === 'fijo'
          ? undefined
          : `× ${addon.kind === 'porPersona' ? sel.invitados : a.cantidad}`,
      monto: round2(monto),
      ivaIncluido: false,
    });
  }

  // 5. Totales con desglose fiscal coherente.
  // rentaConIva y alimentosConIva ya incluyen IVA => se descomponen para reportar el IVA real.
  const conIva = rentaConIva + alimentosConIva;
  const conIvaBase = conIva / (1 + catalog.ivaRate);
  const conIvaImpuesto = conIva - conIvaBase;

  const baseSinIva = alimentosBaseSinIva + addonsBaseSinIva;
  const ivaSobreBases = baseSinIva * catalog.ivaRate;

  const subtotal = round2(conIvaBase + baseSinIva);
  const iva = round2(conIvaImpuesto + ivaSobreBases);
  const total = round2(conIva + baseSinIva + ivaSobreBases);

  return {
    lines,
    subtotal,
    iva,
    total,
    rentaTotal: round2(rentaConIva),
  };
}
