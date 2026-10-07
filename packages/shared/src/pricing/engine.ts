import type { Catalog, QuoteBreakdown, QuoteLine } from '../types.js';
import type { QuoteSelection } from '../schemas.js';
import { findBracket, nivelConExtras } from './brackets.js';
import { bracketDeParte, capacidadTotal, repartirInvitados } from './reparto.js';
import { dayType } from './day-type.js';
import { precioDelDia, NOMBRE_DIA } from './precioDelDia.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Motor de precios (función pura). Recibe el catálogo y las selecciones y
 * devuelve el desglose congelado. Reglas:
 * - Renta de catálogo: precio(espacio, rango, tipoDía), CON IVA ya incluido; suma
 *   de espacios. Team Building (rentaPlana) usa una tabla PLANA: el mismo precio
 *   para cualquier día.
 * - Descuento de cortesía: `descuentoPct`% de la renta de catálogo. NO es un
 *   descuento más al final: CAMBIA EL PRECIO DE LA RENTA. El resultado
 *   (`rentaBase`) es el precio efectivo, y todo lo que se deriva del precio de la
 *   renta se calcula sobre él (decisión del dueño: "si yo di 50% de descuento,
 *   entonces las horas extras serán el 5% del precio que lleva 50% de descuento").
 * - Horas extra: 5% de `rentaBase` por hora.
 * - Descuento por alimentos: 5% de `rentaBase`.
 * - Capilla: precio completo, SIEMPRE. No se descuenta nunca ("la capilla se cobra
 *   en los días que se cobra; no hay descuentos ni cortesías").
 * - Con 100% de cortesía `rentaBase` es cero, y horas extra y descuento por
 *   alimentos salen cero por aritmética: la renta llega a cero sin necesidad de
 *   topes ni casos especiales. Solo sobrevive la capilla.
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
/** Cómo se cuenta un servicio según su tipo de cobro. */
const UNIDAD_DE = { fijo: 'evento', porPersona: 'personas', porUnidad: 'unidades' } as const;

export function computeQuote(
  catalog: Catalog,
  sel: QuoteSelection,
): QuoteBreakdown {
  if (sel.descuentoPct != null && (sel.descuentoPct < 0 || sel.descuentoPct > 100)) {
    throw new Error(`Descuento de cortesía inválido: ${sel.descuentoPct}% (debe estar entre 0 y 100)`);
  }
  const dt = dayType(sel.fecha);
  const lines: QuoteLine[] = [];

  // 1. Renta de espacios de CATÁLOGO (con IVA) — suma de espacios. Todavía no es
  // la base de nada: el descuento de cortesía la convierte en el precio efectivo.
  // Team Building usa la tabla PLANA (mismo precio todos los días); el resto, por-día.
  const usaFlat = sel.eventTypeId != null && catalog.flatRentalEventTypeIds.includes(sel.eventTypeId);
  const rentalRows = usaFlat ? catalog.rentalPricesFlat : catalog.rentalPrices;
  //
  // Con VARIOS salones la gente se reparte entre ellos y cada uno cobra según la
  // que le toca: 600 invitados en dos salones de 400 son 300 en cada uno. Antes
  // se buscaba el rango de cada salón con el TOTAL, así que esa cotización no se
  // podía crear aunque entre los dos cupieran 800.
  const reparto = repartirInvitados(sel.spaceIds, rentalRows, sel.invitados);
  const variosEspacios = sel.spaceIds.length > 1;
  let rentaEspacios = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = rentalRows.filter((r) => r.spaceId === spaceId);
    const tocan = reparto.get(spaceId) ?? sel.invitados;
    const row = variosEspacios ? bracketDeParte(rows, tocan) : findBracket(rows, tocan);
    if (!row) {
      // El mensaje dice el cupo de TODOS los espacios elegidos, no el de uno: con
      // varios salones, "no cabe" es una respuesta sobre el conjunto, y saber que
      // el tope es 800 es lo que permite corregir.
      const cupo = capacidadTotal(sel.spaceIds, rentalRows);
      throw new Error(
        variosEspacios
          ? `${sel.invitados} invitados no caben en los espacios elegidos (cupo ${Number.isFinite(cupo) ? cupo : '∞'})`
          : `El espacio ${spaceId} no tiene rango de renta para ${sel.invitados} invitados`,
      );
    }
    // "No aplica": ese día no se ofrece en este espacio (con esta tarifa). Antes
    // se marcaba con cero y se cotizaba una renta de $0.
    const precioDia = precioDelDia(row.prices, dt);
    if (precioDia == null) {
      const espacio = catalog.spaceNames?.[spaceId] ?? 'El espacio elegido';
      const dia = dt === 'viernesEspecial' ? 'viernes' : NOMBRE_DIA[dt];
      throw new Error(`${espacio} no se ofrece en ${dia}${usaFlat ? ' con renta plana' : ''}.`);
    }
    // Personas extra: si se pasa del nivel anterior por poquito, se cobra ese
    // nivel más cada persona extra a precio del nivel entre su tope (Arcos sábado:
    // $76,000 / 100 = $760). Va en el MISMO renglón del salón —con su `spaceId`—
    // para que el plan de pagos y los descuentos lo vean como renta de ese salón.
    const nivel = nivelConExtras(rows, row, tocan, catalog.toleranciaExtras ?? 0);
    const precioNivel = precioDelDia(nivel.row.prices, dt);
    const usaExtras = nivel.extras > 0 && precioNivel != null && nivel.row.max != null;
    const porPersonaExtra = usaExtras ? Math.round(precioNivel! / nivel.row.max!) : 0;
    const monto = usaExtras ? precioNivel! + nivel.extras * porPersonaExtra : precioDia;
    rentaEspacios += monto;
    const detalles = [
      // Con un solo salón el reparto no es noticia; con varios, decir cuántos le
      // tocaron es lo que evita que el precio parezca sacado de la manga.
      variosEspacios ? `${tocan} de ${sel.invitados} invitados` : null,
      usaExtras
        ? `nivel hasta ${nivel.row.max} + ${nivel.extras} persona${nivel.extras === 1 ? '' : 's'} extra × ${porPersonaExtra}`
        : null,
    ].filter(Boolean);
    lines.push({
      concepto: `Renta ${spaceId}`,
      detalle: detalles.length ? detalles.join(' · ') : undefined,
      monto: round2(monto),
      ivaIncluido: true,
      grupo: 'renta',
      spaceId,
      ref: { tipo: 'rentaSalon', id: spaceId, cantidad: 1, unidad: 'evento', precioUnitario: round2(monto) },
    });
  }

  // 2. Descuento de cortesía: CAMBIA EL PRECIO DE LA RENTA. `rentaBase` es el
  //    precio efectivo, y de ahí en adelante todo lo que se deriva del precio de la
  //    renta —horas extra y el 5% por alimentos— sale de él, no del de catálogo.
  //
  //    El renglón va pegado a la renta y ANTES de lo que se deriva de ella: así el
  //    contrato se lee de arriba abajo (108,500 · −54,250 · horas extra sobre
  //    54,250) y cuadra a ojo.
  let rentaBase = rentaEspacios;
  const tipoDescuento = sel.esPromocion ? 'Descuento / promoción' : 'Descuento de cortesía';
  if (sel.descuentoPct != null && sel.descuentoPct > 0) {
    const monto = rentaEspacios * (sel.descuentoPct / 100);
    rentaBase -= monto;
    lines.push({
      concepto: `${tipoDescuento} (${sel.descuentoPct}% renta)`,
      detalle: sel.descuentoMotivo,
      monto: round2(-monto),
      ivaIncluido: true,
      grupo: 'renta',
      ref: { tipo: 'descuento', cantidad: 1, unidad: 'evento', precioUnitario: round2(-monto) },
    });
  } else if (sel.descuentoMonto != null && sel.descuentoMonto > 0) {
    // En monto fijo: nunca más que la renta de los salones (la renta no queda negativa).
    const monto = Math.min(sel.descuentoMonto, rentaEspacios);
    rentaBase -= monto;
    lines.push({
      concepto: `${tipoDescuento} ($${monto.toLocaleString('es-MX')} renta)`,
      detalle: sel.descuentoMotivo,
      monto: round2(-monto),
      ivaIncluido: true,
      grupo: 'renta',
      ref: { tipo: 'descuento', cantidad: 1, unidad: 'evento', precioUnitario: round2(-monto) },
    });
  }

  // 3. Horas extra (5% del precio YA descontado por hora, con IVA porque es sobre
  //    la renta). Con 100% de cortesía `rentaBase` es cero y esto sale cero.
  let rentaConIva = rentaBase;
  if (sel.horasExtra > 0) {
    const monto = rentaBase * catalog.extraHourRate * sel.horasExtra;
    rentaConIva += monto;
    lines.push({
      concepto: 'Horas extra',
      detalle: `${sel.horasExtra} × 5% renta`,
      monto: round2(monto),
      ivaIncluido: true,
      grupo: 'renta',
      ref: { tipo: 'horasExtra', cantidad: sel.horasExtra, unidad: 'horas', precioUnitario: round2(monto / sel.horasExtra) },
    });
  }

  // 3b. Capilla (opcional): cortesía entre semana, $5,000 en sábado. Va al total
  //     (rentaConIva) pero NUNCA se descuenta ni entra a la base de horas extra o
  //     del descuento por alimentos: "se cobra en los días que se cobra".
  if (sel.usaCapilla) {
    const monto = dt === 'sabado' ? catalog.capillaSabado : 0;
    rentaConIva += monto;
    lines.push({
      concepto: 'Capilla',
      detalle: dt === 'sabado' ? undefined : 'cortesía',
      monto: round2(monto),
      ivaIncluido: true,
      grupo: 'renta',
      ref: { tipo: 'capilla', cantidad: 1, unidad: 'evento', precioUnitario: round2(monto) },
    });
  }

  // 4. Alimentos + descuento 5% (sobre `rentaBase` —el precio ya descontado—, no
  //    sobre horas extra ni capilla).
  let alimentosBaseSinIva = 0; // porción que aún NO trae IVA
  let otrosConIva = 0; // porción de `otros` que YA trae IVA (paquete ivaIncluido, extras)
  if (sel.foodPackageId) {
    const pkg = catalog.foodPackages.find((p) => p.id === sel.foodPackageId);
    if (!pkg) throw new Error(`Paquete de alimentos ${sel.foodPackageId} no existe`);
    const rango = findBracket(pkg.brackets, sel.invitados);
    if (!rango) {
      throw new Error(
        `El paquete ${pkg.name} no tiene rango para ${sel.invitados} invitados`,
      );
    }
    // Mismas personas extra que la renta: todos al precio por persona del nivel
    // anterior si apenas se pasan de él.
    const { row, extras } = nivelConExtras(pkg.brackets, rango, sel.invitados, catalog.toleranciaExtras ?? 0);
    const monto = row.pricePerPerson * sel.invitados;
    if (pkg.ivaIncluded) otrosConIva += monto;
    else alimentosBaseSinIva += monto;
    lines.push({
      concepto: `Alimentos ${pkg.name}`,
      detalle:
        `${sel.invitados} × ${row.pricePerPerson}` +
        (extras > 0 ? ` (precio del nivel hasta ${row.max}: ${extras} extra)` : ''),
      monto: round2(monto),
      ivaIncluido: pkg.ivaIncluded,
      grupo: 'otros',
      ref: { tipo: 'alimentos', id: pkg.id, cantidad: sel.invitados, unidad: 'personas', precioUnitario: row.pricePerPerson },
    });

    // El descuento del 5% aplica SOLO a la renta => va en el grupo de renta, y se
    // calcula sobre el precio YA descontado: con 100% de cortesía sale en $0.
    const descuento = rentaBase * catalog.foodDiscountRate;
    rentaConIva -= descuento;
    lines.push({
      concepto: 'Descuento por alimentos (5% renta)',
      monto: round2(-descuento),
      ivaIncluido: true,
      grupo: 'renta',
      ref: { tipo: 'descuentoAlimentos', cantidad: 1, unidad: 'evento', precioUnitario: round2(-descuento) },
    });
  }

  // 5. Add-ons (sin IVA => se agrega).
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
    const cantidadAddOn = addon.kind === 'fijo' ? 1 : addon.kind === 'porPersona' ? sel.invitados : a.cantidad;
    lines.push({
      concepto: addon.name,
      detalle:
        addon.kind === 'fijo'
          ? undefined
          : `× ${addon.kind === 'porPersona' ? sel.invitados : a.cantidad}`,
      monto: round2(monto),
      ivaIncluido: false,
      grupo: 'otros',
      ref: {
        tipo: 'servicioCatalogo',
        id: addon.id,
        cantidad: cantidadAddOn,
        unidad: UNIDAD_DE[addon.kind],
        precioUnitario: addon.price,
        // Se congelan con el evento, igual que el precio (Eduardo, 6-oct-2026).
        proveedorId: addon.proveedorId ?? null,
        comisionPct: addon.proveedorId ? addon.comisionPct ?? null : null,
        cobra: addon.cobra ?? 'proveedor',
      },
    });
  }

  // 5b. DJ Hora extra (opcional, manual): precio por tipo de evento × horas extra.
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
        ref: { tipo: 'djHoraExtra', cantidad: sel.horasExtra, unidad: 'horas', precioUnitario: precioDj },
      });
    }
  }

  // 5c. Servicios sueltos de ESTE evento (fuera del catálogo). El monto capturado
  //     YA trae IVA —lo teclado es lo final, decisión del dueño—, así que a
  //     diferencia de los add-ons NO se le agrega 16%.
  //
  //     Van al grupo `otros`, no a `renta`: con eso quedan fuera de la base del
  //     complemento y de la de los descuentos. Si entraran a la renta cambiarían
  //     el plan de pagos de todo evento que use un extra.
  for (const [i, e] of sel.extras.entries()) {
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
      ref: {
        tipo: 'servicioEvento',
        id: String(i + 1),
        cantidad: e.kind === 'fijo' ? 1 : e.kind === 'porPersona' ? sel.invitados : e.cantidad,
        unidad: UNIDAD_DE[e.kind],
        precioUnitario: e.monto,
      },
    });
  }

  // 6. Totales por BLOQUE, cada uno con su propio subtotal + IVA + total, para
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

/**
 * Cuánto cuesta UNA persona más en este evento, al precio de su nivel. Es lo que
 * el punto de venta sugiere para "invitados extra" cuando llegan más de los
 * contratados.
 *
 * - `renta`: el precio del nivel que se cobra entre su tope (Arcos sábado
 *   $76,000 / 100 = $760), con el mismo nivel —y las mismas personas extra— que
 *   usó el motor. Con varios salones, la renta de todos entre la suma de topes.
 * - `alimentos`: el precio por persona del paquete en ese nivel, con IVA.
 *
 * `null` = no aplica (sin paquete de alimentos, o sin precio para ese día).
 */
export function porPersonaDelNivel(
  catalog: Catalog,
  sel: QuoteSelection,
): { renta: number | null; alimentos: number | null } {
  const dt = dayType(sel.fecha);
  const tol = catalog.toleranciaExtras ?? 0;
  const usaFlat = sel.eventTypeId != null && catalog.flatRentalEventTypeIds.includes(sel.eventTypeId);
  const rentalRows = usaFlat ? catalog.rentalPricesFlat : catalog.rentalPrices;
  const reparto = repartirInvitados(sel.spaceIds, rentalRows, sel.invitados);
  let precio = 0;
  let topes = 0;
  for (const spaceId of sel.spaceIds) {
    const rows = rentalRows.filter((r) => r.spaceId === spaceId);
    const tocan = reparto.get(spaceId) ?? sel.invitados;
    const rango = sel.spaceIds.length > 1 ? bracketDeParte(rows, tocan) : findBracket(rows, tocan);
    if (!rango) return { renta: null, alimentos: null };
    const { row } = nivelConExtras(rows, rango, tocan, tol);
    const p = precioDelDia(row.prices, dt);
    if (p == null) return { renta: null, alimentos: null };
    precio += p;
    topes += row.max ?? Math.max(row.min, tocan);
  }
  const renta = topes > 0 ? Math.round(precio / topes) : null;

  let alimentos: number | null = null;
  const pkg = sel.foodPackageId ? catalog.foodPackages.find((p) => p.id === sel.foodPackageId) : undefined;
  if (pkg) {
    const rango = findBracket(pkg.brackets, sel.invitados);
    if (rango) {
      const { row } = nivelConExtras(pkg.brackets, rango, sel.invitados, tol);
      alimentos = Math.round(row.pricePerPerson * (pkg.ivaIncluded ? 1 : 1 + catalog.ivaRate));
    }
  }
  return { renta, alimentos };
}
