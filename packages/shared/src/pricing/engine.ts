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
 *   Team Building (rentaPlana) usa una tabla PLANA: el mismo precio para cualquier día.
 * - Horas extra: 5% de la renta de espacios (base) por hora.
 * - Descuento por alimentos: 5% de la renta de espacios (base). Horas extra y
 *   descuento se calculan sobre la MISMA base (espacios), no se componen entre sí.
 * - Descuento de cortesía: `descuentoPct`% de la renta de espacios (LA MISMA base
 *   que el 5% por alimentos, sin componerse con él). Con los dos juntos la suma
 *   podría pasarse de la base y dejar la renta en negativo, así que los descuentos
 *   JUNTOS se topan en la base: el de cortesía es el que se recorta.
 * - Alimentos: precio por persona × invitados. Si el paquete NO trae IVA, se le agrega.
 * - Add-ons: fijo | porPersona (× invitados) | porUnidad (× cantidad). SIN IVA => se agrega.
 * - Extras (servicios sueltos de ESTE evento, fuera del catálogo): mismos tipos de
 *   cobro que un add-on, pero el monto capturado YA trae IVA (no se le agrega) y
 *   van al grupo `otros`, así que NO entran a la base del complemento ni de los
 *   descuentos.
 * - DJ Hora extra (opcional): precio por tipo de evento × horas extra. SIN IVA => se agrega.
 * - `subtotal` es genuinamente pre-IVA y `iva` es el impuesto total; `subtotal + iva == total`.
 *   Es un desglose interno para el plan de pagos, no un desglose fiscal/CFDI.
 * - Cada línea lleva `grupo`: `renta` (espacios, horas extra, capilla, descuentos)
 *   u `otros` (alimentos y servicios). `rentaTotal + otrosTotal == total`.
 */
export function computeQuote(
  catalog: Catalog,
  sel: QuoteSelection,
): QuoteBreakdown {
  if (sel.descuentoPct != null && (sel.descuentoPct < 0 || sel.descuentoPct > 100)) {
    throw new Error(`Descuento de cortesía inválido: ${sel.descuentoPct}% (debe estar entre 0 y 100)`);
  }
  const dt = dayType(sel.fecha);
  const lines: QuoteLine[] = [];

  // 1. Renta de espacios (con IVA) — suma de espacios. Base para 5% y horas extra.
  // Team Building usa la tabla PLANA (mismo precio todos los días); el resto, por-día.
  const usaFlat = sel.eventTypeId != null && catalog.flatRentalEventTypeIds.includes(sel.eventTypeId);
  const rentalRows = usaFlat ? catalog.rentalPricesFlat : catalog.rentalPrices;
  let rentaEspacios = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = rentalRows.filter((r) => r.spaceId === spaceId);
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
    lines.push({ concepto: `Renta ${spaceId}`, monto: round2(monto), ivaIncluido: true, grupo: 'renta', spaceId });
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
      grupo: 'renta',
    });
  }

  // 2b. Capilla (opcional): cortesía entre semana, $5,000 en sábado. Va al total
  //     (rentaConIva) pero NO a la base de horas extra / descuento por alimentos.
  if (sel.usaCapilla) {
    const monto = dt === 'sabado' ? catalog.capillaSabado : 0;
    rentaConIva += monto;
    lines.push({
      concepto: 'Capilla',
      detalle: dt === 'sabado' ? undefined : 'cortesía',
      monto: round2(monto),
      ivaIncluido: true,
      grupo: 'renta',
    });
  }

  // 3. Alimentos + descuento 5% (sobre la renta de espacios base, no sobre horas extra).
  let alimentosBaseSinIva = 0; // porción que aún NO trae IVA
  let otrosConIva = 0; // porción de `otros` que YA trae IVA (paquete ivaIncluido, extras)
  /** Lo ya descontado de la base `rentaEspacios`. Topa al descuento de cortesía. */
  let descuentoSobreBase = 0;
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
    if (pkg.ivaIncluded) otrosConIva += monto;
    else alimentosBaseSinIva += monto;
    lines.push({
      concepto: `Alimentos ${pkg.name}`,
      detalle: `${sel.invitados} × ${row.pricePerPerson}`,
      monto: round2(monto),
      ivaIncluido: pkg.ivaIncluded,
      grupo: 'otros',
    });

    // El descuento del 5% aplica SOLO a la renta => va en el grupo de renta.
    const descuento = rentaEspacios * catalog.foodDiscountRate;
    rentaConIva -= descuento;
    descuentoSobreBase += descuento;
    lines.push({
      concepto: 'Descuento por alimentos (5% renta)',
      monto: round2(-descuento),
      ivaIncluido: true,
      grupo: 'renta',
    });
  }

  // 3b. Descuento de cortesía: `descuentoPct`% de la renta de ESPACIOS, la misma
  //     base que el 5% por alimentos y sin componerse con él (50% de cortesía con
  //     alimentos descuenta 50% de 108,500, no de 103,075).
  //
  //     Los dos juntos pueden pasarse de la base —100% + 5% = 105%— y dejar la
  //     renta en negativo, que rompe el plan de pagos. Por eso el de cortesía se
  //     topa en lo que queda de la base: con 100% la renta de espacios queda
  //     exactamente en cero, como pidió el dueño.
  //
  //     Horas extra y capilla NO están en la base (igual que para el 5%), así que
  //     sobreviven a una cortesía del 100%.
  if (sel.descuentoPct != null && sel.descuentoPct > 0) {
    const bruto = rentaEspacios * (sel.descuentoPct / 100);
    const tope = Math.max(0, rentaEspacios - descuentoSobreBase);
    const monto = Math.min(bruto, tope);
    rentaConIva -= monto;
    descuentoSobreBase += monto;
    lines.push({
      concepto: `Descuento de cortesía (${sel.descuentoPct}% renta)`,
      detalle: sel.descuentoMotivo,
      monto: round2(-monto),
      ivaIncluido: true,
      grupo: 'renta',
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
      grupo: 'otros',
    });
  }

  // 4b. DJ Hora extra (opcional, manual): precio por tipo de evento × horas extra.
  //     Va en "otros" (servicio; sin IVA => se agrega). Con alimentos, el DJ de las
  //     horas base ya viene incluido; esto cubre solo las horas extra.
  if (sel.usaDjHoraExtra && sel.horasExtra > 0 && sel.eventTypeId) {
    const precioDj = catalog.djHoraExtraByEventType[sel.eventTypeId];
    if (precioDj != null) {
      const monto = precioDj * sel.horasExtra;
      addonsBaseSinIva += monto;
      lines.push({
        concepto: 'DJ Hora extra',
        detalle: `${sel.horasExtra} h × ${precioDj}`,
        monto: round2(monto),
        ivaIncluido: false,
        grupo: 'otros',
      });
    }
  }

  // 4c. Servicios sueltos de ESTE evento (fuera del catálogo). El monto capturado
  //     YA trae IVA —lo teclado es lo final, decisión del dueño—, así que a
  //     diferencia de los add-ons NO se le agrega 16%.
  //
  //     Van al grupo `otros`, no a `renta`: con eso quedan fuera de la base del
  //     complemento y de la de los descuentos. Si entraran a la renta cambiarían
  //     el plan de pagos de todo evento que use un extra.
  for (const e of sel.extras) {
    let monto: number;
    if (e.kind === 'fijo') monto = e.monto;
    else if (e.kind === 'porPersona') monto = e.monto * sel.invitados;
    else monto = e.monto * e.cantidad;
    otrosConIva += monto;
    lines.push({
      concepto: e.nombre,
      detalle: e.kind === 'fijo' ? undefined : `× ${e.kind === 'porPersona' ? sel.invitados : e.cantidad}`,
      monto: round2(monto),
      ivaIncluido: true,
      grupo: 'otros',
    });
  }

  // 5. Totales por BLOQUE, cada uno con su propio subtotal + IVA + total, para
  //    que el desglose muestre por separado lo que cobra HSA (renta) y lo que se
  //    paga al proveedor (alimentos + servicios). No se mezclan.
  const rate = catalog.ivaRate;

  // Renta: todo trae IVA incluido. Se descompone para reportar subtotal e IVA.
  const rentaTotal = round2(rentaConIva);
  const rentaSubtotal = round2(rentaConIva / (1 + rate));
  const rentaIva = round2(rentaTotal - rentaSubtotal);

  // Otros: parte con IVA incluido (alimentos ivaIncluido, extras) + parte sin IVA.
  const otrosSinIva = alimentosBaseSinIva + addonsBaseSinIva;
  const otrosTotal = round2(otrosConIva + otrosSinIva * (1 + rate));
  const otrosSubtotal = round2(otrosConIva / (1 + rate) + otrosSinIva);
  const otrosIva = round2(otrosTotal - otrosSubtotal);

  // Globales (compat): suma de ambos bloques. subtotal + iva === total.
  const subtotal = round2(rentaSubtotal + otrosSubtotal);
  const iva = round2(rentaIva + otrosIva);
  const total = round2(rentaTotal + otrosTotal);

  return {
    lines,
    subtotal,
    iva,
    total,
    rentaSubtotal,
    rentaIva,
    rentaTotal,
    otrosSubtotal,
    otrosIva,
    otrosTotal,
  };
}
