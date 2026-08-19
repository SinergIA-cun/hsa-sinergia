import { describe, it, expect } from 'vitest';
import { computeQuote } from './engine.js';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
import type { Catalog } from '../types.js';
import type { QuoteSelection } from '../schemas.js';

const catalog: Catalog = {
  ivaRate: 0.16,
  extraHourRate: 0.05,
  foodDiscountRate: 0.05,
  capillaSabado: 5000,
  djHoraExtraByEventType: { boda: 2950, cumpleanos: 2750 },
  rentalPrices: [
    // Los Arcos (id 'arcos')
    { spaceId: 'arcos', min: 1, max: 50, prices: { viernes: 34500, viernesEspecial: 17250, sabado: 42000, domAJue: 30000 } },
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 100000, viernesEspecial: 50000, sabado: 108500, domAJue: 90500 } },
    // La Cúpula (id 'cupula')
    { spaceId: 'cupula', min: 50, max: 300, prices: { viernes: 157000, viernesEspecial: 78500, sabado: 174000, domAJue: 139000 } },
  ],
  // Renta plana (Team Building): mismo precio todos los días. Arcos 201-300 = 50,000.
  rentalPricesFlat: [
    { spaceId: 'arcos', min: 201, max: 300, prices: { viernes: 50000, viernesEspecial: 50000, sabado: 50000, domAJue: 50000 } },
  ],
  flatRentalEventTypeIds: ['team-building'],
  foodPackages: [
    {
      id: 'boda-supreme', eventTypeId: 'boda', name: 'SUPREME', ivaIncluded: false,
      brackets: [
        { packageId: 'boda-supreme', min: 201, max: 300, pricePerPerson: 799 },
      ],
    },
    {
      id: 'boda-conIva', eventTypeId: 'boda', name: 'CON IVA', ivaIncluded: true,
      brackets: [
        { packageId: 'boda-conIva', min: 201, max: 300, pricePerPerson: 800 },
      ],
    },
  ],
  addOns: [
    { id: 'porunidad', name: 'Servicio por unidad', kind: 'porUnidad', price: 100, activo: true },
    { id: 'dj', name: 'DJ', kind: 'fijo', price: 2950, activo: true },
    // Ya no se OFRECE, pero el catálogo lo sigue RESOLVIENDO: las cotizaciones
    // emitidas antes de darlo de baja lo referencian por id en su selección.
    { id: 'valet', name: 'Valet parking', kind: 'porUnidad', price: 100, activo: false },
  ],
};

/** Selección base (sábado, Los Arcos 250 pax); se sobreescribe lo necesario. */
function mk(overrides: Partial<QuoteSelection> = {}): QuoteSelection {
  return {
    fecha: '2027-05-08', // sábado
    invitados: 250,
    spaceIds: ['arcos'],
    horasExtra: 0,
    usaCapilla: false,
    usaDjHoraExtra: false,
    addOns: [],
    extras: [],
    ...overrides,
  };
}

describe('computeQuote', () => {
  it('renta simple sábado (Los Arcos, 250 pax) = 108,500 con IVA', () => {
    const r = computeQuote(catalog, mk());
    expect(r.rentaTotal).toBe(108500);
    expect(r.total).toBe(108500); // renta ya trae IVA, sin más conceptos
  });

  it('renta + alimentos aplica 5% de descuento en renta y agrega IVA a alimentos', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-supreme' }));
    const alimentosBase = 799 * 250;
    const descuento = 108500 * 0.05;
    const rentaNeta = 108500 - descuento;
    const alimentosConIva = alimentosBase * 1.16;
    expect(r.total).toBeCloseTo(rentaNeta + alimentosConIva, 2);
  });

  it('hora extra = 5% de la renta por hora', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 2 }));
    expect(r.total).toBeCloseTo(108500 + 2 * 0.05 * 108500, 2);
  });

  it('add-ons: porUnidad e IVA; DJ fijo con IVA', () => {
    const r = computeQuote(catalog, mk({ addOns: [{ addOnId: 'porunidad', cantidad: 50 }, { addOnId: 'dj', cantidad: 1 }] }));
    const addonBase = 100 * 50 + 2950;
    expect(r.total).toBeCloseTo(108500 + addonBase * 1.16, 2);
  });

  // "Resolver" y "ofrecer" son cosas distintas: el catálogo deja de OFRECER un
  // add-on dado de baja, pero tiene que seguir RESOLVIÉNDOLO o toda cotización
  // histórica que lo referencie queda irrecalculable (y por tanto ineditable).
  it('un add-on inactivo se sigue resolviendo y cobrando igual que uno activo', () => {
    const r = computeQuote(catalog, mk({ addOns: [{ addOnId: 'valet', cantidad: 4 }] }));
    const linea = r.lines.find((l) => l.concepto === 'Valet parking');
    expect(linea).toBeDefined();
    expect(linea!.monto).toBe(100 * 4);
    expect(r.total).toBeCloseTo(108500 + 100 * 4 * 1.16, 2);
  });

  it('el precio NO se mueve solo: inactivo cobra lo mismo que activo con el mismo precio', () => {
    const conInactivo = computeQuote(catalog, mk({ addOns: [{ addOnId: 'valet', cantidad: 7 }] }));
    const conActivo = computeQuote(catalog, mk({ addOns: [{ addOnId: 'porunidad', cantidad: 7 }] }));
    expect(conInactivo.total).toBe(conActivo.total);
  });

  it('un add-on que de verdad NO existe (id basura) sigue lanzando error', () => {
    expect(() =>
      computeQuote(catalog, mk({ addOns: [{ addOnId: 'id-que-no-existe-en-ninguna-parte', cantidad: 1 }] })),
    ).toThrow(/Add-on id-que-no-existe-en-ninguna-parte no existe/);
  });

  it('usaCapilla en sábado agrega $5,000; entre semana es cortesía ($0)', () => {
    const sab = computeQuote(catalog, mk({ usaCapilla: true }));
    expect(sab.rentaTotal).toBe(108500 + 5000);

    // Jueves: capilla no cuesta (cortesía) — comparado contra la misma sin capilla.
    const jueSin = computeQuote(catalog, mk({ fecha: '2027-05-06' }));
    const jueCon = computeQuote(catalog, mk({ fecha: '2027-05-06', usaCapilla: true }));
    expect(jueCon.rentaTotal).toBe(jueSin.rentaTotal);
  });

  it('lanza error si el espacio no tiene rango para los invitados', () => {
    expect(() => computeQuote(catalog, mk({ invitados: 700 }))).toThrow(/rango/i);
  });

  it('paquete con ivaIncluido=true NO recibe 16% extra', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-conIva' }));
    expect(r.total).toBeCloseTo(103075 + 200000, 2);
  });

  it('horas extra + alimentos: ambos 5% sobre la renta de espacios base (no compuestos)', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 2, foodPackageId: 'boda-supreme' }));
    expect(r.total).toBeCloseTo(113925 + 199750 * 1.16, 2);
  });

  it('rentaTotal + otrosTotal === total y otros = alimentos + servicios', () => {
    const r = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }),
    );
    expect(round2(r.rentaTotal + r.otrosTotal)).toBe(r.total);
    // "otros" = alimentos con IVA + add-on por unidad con IVA.
    const otrosEsperado = 799 * 250 * 1.16 + 100 * 50 * 1.16;
    expect(r.otrosTotal).toBeCloseTo(otrosEsperado, 2);
  });

  it('sin alimentos ni servicios, otrosTotal = 0 y toda la renta es rentaTotal', () => {
    const r = computeQuote(catalog, mk());
    expect(r.otrosTotal).toBe(0);
    expect(r.rentaTotal).toBe(r.total);
  });

  it('el descuento 5% va en el grupo renta y los alimentos en otros', () => {
    const r = computeQuote(catalog, mk({ foodPackageId: 'boda-supreme' }));
    const descuento = r.lines.find((l) => l.concepto.startsWith('Descuento'));
    const alimentos = r.lines.find((l) => l.concepto.startsWith('Alimentos'));
    expect(descuento?.grupo).toBe('renta');
    expect(alimentos?.grupo).toBe('otros');
    // rentaTotal ya trae el descuento restado.
    expect(r.rentaTotal).toBeCloseTo(108500 - 108500 * 0.05, 2);
  });

  it('DJ Hora extra: precio por tipo de evento × horas extra, con IVA agregado', () => {
    const r = computeQuote(
      catalog,
      mk({ eventTypeId: 'boda', usaDjHoraExtra: true, horasExtra: 2 }),
    );
    const dj = r.lines.find((l) => l.concepto === 'DJ Hora extra');
    expect(dj?.monto).toBe(2950 * 2);
    expect(dj?.grupo).toBe('otros');
    // Renta con horas extra + DJ (2×2950) con IVA.
    const rentaConHoras = 108500 + 2 * 0.05 * 108500;
    expect(r.total).toBeCloseTo(rentaConHoras + 2950 * 2 * 1.16, 2);
  });

  it('DJ Hora extra sin horas extra no cobra nada', () => {
    const r = computeQuote(catalog, mk({ eventTypeId: 'boda', usaDjHoraExtra: true, horasExtra: 0 }));
    expect(r.lines.find((l) => l.concepto === 'DJ Hora extra')).toBeUndefined();
    expect(r.total).toBe(108500);
  });

  it('Team Building usa renta plana: mismo precio en sábado que entre semana', () => {
    const sab = computeQuote(catalog, mk({ eventTypeId: 'team-building', fecha: '2027-05-08' }));
    const jue = computeQuote(catalog, mk({ eventTypeId: 'team-building', fecha: '2027-05-06' }));
    expect(sab.rentaTotal).toBe(50000);
    expect(jue.rentaTotal).toBe(50000); // plano: no varía por día (vs. 108,500 sábado normal)
  });

  it('un evento normal NO usa la renta plana (sábado sigue en 108,500)', () => {
    const r = computeQuote(catalog, mk({ eventTypeId: 'boda', fecha: '2027-05-08' }));
    expect(r.rentaTotal).toBe(108500);
  });

  it('cada bloque cuadra: rentaSubtotal+rentaIva=rentaTotal y otrosSubtotal+otrosIva=otrosTotal', () => {
    const r = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }),
    );
    expect(round2(r.rentaSubtotal + r.rentaIva)).toBe(r.rentaTotal);
    expect(round2(r.otrosSubtotal + r.otrosIva)).toBe(r.otrosTotal);
    expect(round2(r.rentaSubtotal + r.otrosSubtotal)).toBe(r.subtotal);
    expect(round2(r.rentaTotal + r.otrosTotal)).toBe(r.total);
    // La renta trae IVA incluido: subtotal = total / 1.16.
    expect(r.rentaSubtotal).toBeCloseTo(r.rentaTotal / 1.16, 2);
  });

  it('subtotal + iva === total', () => {
    const r = computeQuote(catalog, mk({ horasExtra: 1, foodPackageId: 'boda-supreme', addOns: [{ addOnId: 'porunidad', cantidad: 50 }] }));
    expect(r.subtotal + r.iva).toBeCloseTo(r.total, 2);
  });

  it('lanza error si falta el precio del día para un espacio', () => {
    const roto: Catalog = {
      ...catalog,
      rentalPrices: [
        { spaceId: 'roto', min: 1, max: null, prices: { viernes: 0, viernesEspecial: 0, domAJue: 0 } as unknown as Record<'viernes' | 'viernesEspecial' | 'sabado' | 'domAJue', number> },
      ],
    };
    expect(() => computeQuote(roto, mk({ spaceIds: ['roto'], invitados: 100 }))).toThrow(/Falta precio/i);
  });

  it('las líneas de renta llevan spaceId; las demás no', () => {
    // El catálogo de prueba tiene 'arcos' (201-300) y 'cupula' (50-300): con 250
    // invitados ambos tienen fila de renta.
    const b = computeQuote(catalog, {
      fecha: '2027-05-08',
      invitados: 250,
      spaceIds: ['arcos', 'cupula'],
      horasExtra: 1,
      usaCapilla: false,
      usaDjHoraExtra: false,
      addOns: [],
      extras: [],
    });

    const rentas = b.lines.filter((l) => l.spaceId != null);
    expect(rentas).toHaveLength(2);
    expect(rentas.map((l) => l.spaceId).sort()).toEqual(['arcos', 'cupula']);

    const horasExtra = b.lines.find((l) => l.concepto === 'Horas extra')!;
    expect(horasExtra.spaceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Servicio suelto del evento (`extras`). No es un add-on del catálogo: vive en
// LA cotización, así que no puede cambiar bajo sus pies. El monto capturado
// SIEMPRE trae IVA incluido (decisión del dueño): lo teclado es lo final.
// ---------------------------------------------------------------------------
describe('computeQuote · servicios sueltos del evento (extras)', () => {
  it('porPersona: $200 × 250 invitados = $50,000 en el grupo otros, con IVA incluido', () => {
    const r = computeQuote(
      catalog,
      mk({ extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    const linea = r.lines.find((l) => l.concepto === 'Cambio de menú')!;
    expect(linea.monto).toBe(50000);
    expect(linea.grupo).toBe('otros');
    expect(linea.ivaIncluido).toBe(true);
    expect(linea.detalle).toBe('× 250');
  });

  it('el monto capturado es FINAL: no se le agrega 16% encima', () => {
    const r = computeQuote(
      catalog,
      mk({ extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    // 50,000 exactos, NO 58,000. Es la decisión del dueño y es dinero.
    expect(r.otrosTotal).toBe(50000);
    expect(r.total).toBe(108500 + 50000);
  });

  it('fijo: el monto tal cual, sin multiplicar por nada', () => {
    const r = computeQuote(catalog, mk({ extras: [{ nombre: 'Grúa', kind: 'fijo', monto: 7500, cantidad: 9 }] }));
    const linea = r.lines.find((l) => l.concepto === 'Grúa')!;
    expect(linea.monto).toBe(7500); // la cantidad se ignora en `fijo`
    expect(linea.detalle).toBeUndefined();
    expect(r.otrosTotal).toBe(7500);
  });

  it('porUnidad: monto × cantidad', () => {
    const r = computeQuote(catalog, mk({ extras: [{ nombre: 'Sombrilla', kind: 'porUnidad', monto: 350, cantidad: 12 }] }));
    const linea = r.lines.find((l) => l.concepto === 'Sombrilla')!;
    expect(linea.monto).toBe(350 * 12);
    expect(linea.detalle).toBe('× 12');
    expect(r.otrosTotal).toBe(4200);
  });

  it('varios extras se suman entre sí', () => {
    const r = computeQuote(
      catalog,
      mk({
        extras: [
          { nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 },
          { nombre: 'Grúa', kind: 'fijo', monto: 7500, cantidad: 1 },
        ],
      }),
    );
    expect(r.otrosTotal).toBe(50000 + 7500);
  });

  // LA consecuencia que hay que fijar: el extra va a `otros`, NO a `renta`. Si
  // entrara a la renta cambiaría la base del complemento y el plan de pagos de
  // todos los eventos que usen un extra.
  it('el extra NO toca rentaTotal: no entra a la base del complemento', () => {
    const sin = computeQuote(catalog, mk());
    const con = computeQuote(
      catalog,
      mk({ extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    expect(con.rentaTotal).toBe(sin.rentaTotal);
    expect(con.rentaSubtotal).toBe(sin.rentaSubtotal);
    expect(con.rentaIva).toBe(sin.rentaIva);
    expect(con.total).toBe(sin.total + 50000);
  });

  it('el extra NO entra a la base del descuento por alimentos', () => {
    const sin = computeQuote(catalog, mk({ foodPackageId: 'boda-supreme' }));
    const con = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    const descuentoDe = (b: typeof sin) => b.lines.find((l) => l.concepto.startsWith('Descuento por alimentos'))!.monto;
    expect(descuentoDe(con)).toBe(descuentoDe(sin));
    expect(descuentoDe(con)).toBe(-5425); // 5% de 108,500, no de 158,500
  });

  it('el extra NO entra a la base del descuento de cortesía', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 100, descuentoMotivo: 'Boda del dueño', extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    expect(r.rentaTotal).toBe(0);
    expect(r.otrosTotal).toBe(50000); // el extra se cobra completo
    expect(r.total).toBe(50000);
  });

  it('cada bloque sigue cuadrando con extras (con IVA incluido en otros)', () => {
    const r = computeQuote(
      catalog,
      mk({ foodPackageId: 'boda-supreme', extras: [{ nombre: 'Cambio de menú', kind: 'porPersona', monto: 200, cantidad: 1 }] }),
    );
    expect(round2(r.otrosSubtotal + r.otrosIva)).toBe(r.otrosTotal);
    expect(round2(r.rentaTotal + r.otrosTotal)).toBe(r.total);
    expect(round2(r.subtotal + r.iva)).toBe(r.total);
    // Alimentos SIN IVA (se agrega) + extra CON IVA (no se agrega).
    expect(r.otrosTotal).toBeCloseTo(199750 * 1.16 + 50000, 2);
  });
});

// ---------------------------------------------------------------------------
// Descuento de cortesía. `esCortesia` nunca afectó el precio; esto se lo da.
//
// LA REGLA (dueño, 13-ago-2026, corrigiendo la primera versión): el descuento
// cambia el PRECIO DE LA RENTA. Todo lo que se deriva de ese precio —horas extra
// y el 5% por alimentos— se calcula sobre el precio YA descontado. Textual:
// "Si yo di 50% de descuento, entonces las horas extras serán el 5% del precio
// que lleva 50% de descuento". La capilla NO se descuenta nunca.
//
// Por eso ya no hay tope: con 100% el precio de la renta es cero y todo lo que
// se deriva de él sale cero por aritmética, sin reglas inventadas.
// ---------------------------------------------------------------------------
describe('computeQuote · descuento de cortesía', () => {
  it('100% deja rentaTotal en cero y otrosTotal intacto', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 100, descuentoMotivo: 'Boda de la familia' }),
    );
    expect(r.rentaTotal).toBe(0);
    expect(r.rentaSubtotal).toBe(0);
    expect(r.rentaIva).toBe(0);
    expect(r.total).toBe(0);
  });

  it('100% con alimentos: la renta queda en cero y los alimentos se cobran completos', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 100, descuentoMotivo: 'Boda de la familia', foodPackageId: 'boda-supreme' }),
    );
    expect(r.rentaTotal).toBe(0);
    expect(r.otrosTotal).toBeCloseTo(199750 * 1.16, 2);
    expect(r.total).toBe(r.otrosTotal);
    // El 5% por alimentos es 5% del precio de la renta, y ese precio es cero:
    // el renglón sigue apareciendo, pero en $0. No hay nada que topar.
    expect(r.lines.find((l) => l.concepto.startsWith('Descuento por alimentos'))!.monto).toBe(0);
  });

  it('50% deja la mitad de la renta', () => {
    const r = computeQuote(catalog, mk({ descuentoPct: 50, descuentoMotivo: 'Media cortesía' }));
    expect(r.rentaTotal).toBe(54250);
  });

  it('el renglón del descuento va en el grupo renta, con monto negativo y el motivo a la vista', () => {
    const r = computeQuote(catalog, mk({ descuentoPct: 25, descuentoMotivo: 'Sobrina del dueño' }));
    const linea = r.lines.find((l) => l.concepto.startsWith('Descuento de cortesía'))!;
    expect(linea.grupo).toBe('renta');
    expect(linea.monto).toBe(-27125);
    expect(linea.ivaIncluido).toBe(true);
    expect(linea.concepto).toBe('Descuento de cortesía (25% renta)');
    expect(linea.detalle).toBe('Sobrina del dueño');
  });

  // El renglón del descuento va JUNTO a lo que descuenta y ANTES de lo que se
  // deriva de él. Si apareciera al final, el contrato mostraría unas horas extra
  // de 5,425 debajo de una renta de 108,500 y no cuadraría a ojo.
  it('el renglón del descuento va pegado a la renta, antes de las horas extra', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 50, descuentoMotivo: 'Media cortesía', horasExtra: 2 }),
    );
    expect(r.lines.map((l) => l.concepto)).toEqual([
      'Renta arcos',
      'Descuento de cortesía (50% renta)',
      'Horas extra',
    ]);
  });

  // LA regla corregida, en un solo test: las horas extra son el 5% del precio
  // que YA lleva el descuento, no el 5% del precio de folleto.
  it('las horas extra son el 5% del precio YA descontado', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 50, descuentoMotivo: 'Media cortesía', horasExtra: 2 }),
    );
    const horas = r.lines.find((l) => l.concepto === 'Horas extra')!;
    expect(horas.monto).toBe(5425); // 2 × 5% × 54,250, NO 2 × 5% × 108,500
    expect(r.rentaTotal).toBe(59675); // 54,250 + 5,425
  });

  // Misma regla para el otro descuento: el 5% por alimentos también sale del
  // precio descontado. Esto SÍ se compone con el de cortesía, a propósito: no son
  // dos descuentos sobre una misma base, es un precio nuevo y un 5% sobre él.
  it('el 5% por alimentos es 5% del precio YA descontado', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 50, descuentoMotivo: 'Media cortesía', foodPackageId: 'boda-supreme' }),
    );
    const cortesia = r.lines.find((l) => l.concepto.startsWith('Descuento de cortesía'))!;
    const alimentos = r.lines.find((l) => l.concepto.startsWith('Descuento por alimentos'))!;
    expect(cortesia.monto).toBe(-54250); // 50% de 108,500
    expect(alimentos.monto).toBe(-2712.5); // 5% de 54,250, NO de 108,500
    expect(r.rentaTotal).toBe(51537.5); // 54,250 − 2,712.50
  });

  // El caso que el plan exige fijar, completo: renta de folleto 108,500, 2 horas
  // extra, capilla en sábado, con paquete de alimentos.
  it('caso fijado del plan · 50%: rentaTotal = 61,962.50', () => {
    const r = computeQuote(
      catalog,
      mk({
        descuentoPct: 50,
        descuentoMotivo: 'Media cortesía',
        horasExtra: 2,
        usaCapilla: true,
        foodPackageId: 'boda-supreme',
      }),
    );
    const monto = (c: string) => r.lines.find((l) => l.concepto.startsWith(c))!.monto;
    expect(monto('Renta arcos')).toBe(108500);
    expect(monto('Descuento de cortesía')).toBe(-54250);
    expect(monto('Horas extra')).toBe(5425);
    expect(monto('Capilla')).toBe(5000);
    expect(monto('Descuento por alimentos')).toBe(-2712.5);
    // 54,250 + 5,425 − 2,712.50 + 5,000
    expect(r.rentaTotal).toBe(61962.5);
  });

  it('caso fijado del plan · 100%: rentaTotal = 5,000, nada más que la capilla', () => {
    const r = computeQuote(
      catalog,
      mk({
        descuentoPct: 100,
        descuentoMotivo: 'Cortesía total',
        horasExtra: 2,
        usaCapilla: true,
        foodPackageId: 'boda-supreme',
      }),
    );
    const monto = (c: string) => r.lines.find((l) => l.concepto.startsWith(c))!.monto;
    expect(monto('Descuento de cortesía')).toBe(-108500); // completo, sin topar
    expect(monto('Horas extra')).toBe(0); // 5% de cero
    expect(monto('Descuento por alimentos')).toBe(0); // 5% de cero
    expect(monto('Capilla')).toBe(5000); // la capilla NO se descuenta
    expect(r.rentaTotal).toBe(5000);
  });

  // La capilla se cobra en los días que se cobra: "No hay descuentos ni
  // cortesías" (dueño). Es el único renglón de renta que el descuento no toca.
  it('la capilla se cobra completa aunque la cortesía sea del 100%', () => {
    const sab = computeQuote(
      catalog,
      mk({ descuentoPct: 100, descuentoMotivo: 'Cortesía total', usaCapilla: true }),
    );
    expect(sab.lines.find((l) => l.concepto === 'Capilla')!.monto).toBe(5000);
    expect(sab.rentaTotal).toBe(5000);

    // Entre semana la capilla ya era cortesía: con 100% la renta queda en cero.
    const jue = computeQuote(
      catalog,
      mk({ fecha: '2027-05-06', descuentoPct: 100, descuentoMotivo: 'Cortesía total', usaCapilla: true }),
    );
    expect(jue.rentaTotal).toBe(0);
  });

  // Sin tope y sin reglas inventadas: el 100% no puede dejar la renta en negativo
  // porque todo lo que se resta sale del precio ya descontado, que es cero.
  it('con 100% la renta llega a cero por aritmética, nunca a negativo', () => {
    const r = computeQuote(
      catalog,
      mk({ descuentoPct: 100, descuentoMotivo: 'Cortesía total', horasExtra: 3, foodPackageId: 'boda-supreme' }),
    );
    expect(r.rentaTotal).toBe(0);
    expect(r.rentaTotal).toBeGreaterThanOrEqual(0);
  });

  it('sin descuentoPct (o en 0) no aparece ningún renglón de cortesía', () => {
    const sin = computeQuote(catalog, mk());
    const cero = computeQuote(catalog, mk({ descuentoPct: 0 }));
    expect(sin.lines.some((l) => l.concepto.startsWith('Descuento de cortesía'))).toBe(false);
    expect(cero.lines.some((l) => l.concepto.startsWith('Descuento de cortesía'))).toBe(false);
    expect(cero.rentaTotal).toBe(sin.rentaTotal);
  });

  it('un descuentoPct fuera de 0..100 se rechaza', () => {
    expect(() => computeQuote(catalog, mk({ descuentoPct: 101 }))).toThrow(/descuento/i);
    expect(() => computeQuote(catalog, mk({ descuentoPct: -1 }))).toThrow(/descuento/i);
  });
});

// ---------------------------------------------------------------------------
// No-regresión. TRES cambios de este plan tocan el motor —los extras del evento,
// el descuento de cortesía y el reordenamiento de la CORRECCIÓN— y una regresión
// aquí mueve dinero en TODAS las cotizaciones. Los literales son el desglose que
// devolvía el motor ANTES de esas tasks, capturado antes de tocarlo, y han
// sobrevivido los tres cambios sin moverse una línea. NO se tocan: si se ponen
// rojos, algo movió dinero.
// ---------------------------------------------------------------------------
describe('computeQuote · no-regresión: sin extras y sin descuento nada se movió', () => {
  it('renta sola: desglose idéntico al de antes del plan G', () => {
    expect(computeQuote(catalog, mk())).toEqual({
      lines: [{ concepto: 'Renta arcos', monto: 108500, ivaIncluido: true, grupo: 'renta', spaceId: 'arcos' }],
      subtotal: 93534.48,
      iva: 14965.52,
      total: 108500,
      rentaSubtotal: 93534.48,
      rentaIva: 14965.52,
      rentaTotal: 108500,
      otrosSubtotal: 0,
      otrosIva: 0,
      otrosTotal: 0,
    });
  });

  it('cotización completa (horas extra, capilla, alimentos, add-on y DJ): desglose idéntico al de antes', () => {
    const r = computeQuote(
      catalog,
      mk({
        horasExtra: 2,
        usaCapilla: true,
        eventTypeId: 'boda',
        usaDjHoraExtra: true,
        foodPackageId: 'boda-supreme',
        addOns: [{ addOnId: 'dj', cantidad: 1 }],
      }),
    );
    expect(r).toEqual({
      lines: [
        { concepto: 'Renta arcos', monto: 108500, ivaIncluido: true, grupo: 'renta', spaceId: 'arcos' },
        { concepto: 'Horas extra', detalle: '2 × 5% renta', monto: 10850, ivaIncluido: true, grupo: 'renta' },
        { concepto: 'Capilla', monto: 5000, ivaIncluido: true, grupo: 'renta' },
        { concepto: 'Alimentos SUPREME', detalle: '250 × 799', monto: 199750, ivaIncluido: false, grupo: 'otros' },
        { concepto: 'Descuento por alimentos (5% renta)', monto: -5425, ivaIncluido: true, grupo: 'renta' },
        { concepto: 'DJ', monto: 2950, ivaIncluido: false, grupo: 'otros' },
        { concepto: 'DJ Hora extra', detalle: '2 h × 2950', monto: 5900, ivaIncluido: false, grupo: 'otros' },
      ],
      subtotal: 311121.55,
      iva: 49779.45,
      total: 360901,
      rentaSubtotal: 102521.55,
      rentaIva: 16403.45,
      rentaTotal: 118925,
      otrosSubtotal: 208600,
      otrosIva: 33376,
      otrosTotal: 241976,
    });
  });
});
