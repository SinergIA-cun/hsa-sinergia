import type { PrismaClient } from '@hsa/database';

/**
 * El catálogo del DEMO. Inventado de arriba a abajo, a propósito.
 *
 * No es el catálogo de la hacienda: sus precios y sus banqueteros son
 * información suya, y el demo se le muestra a otros salones de eventos, que son
 * su competencia. Números redondos, salones y banqueteros que no existen.
 *
 * Los precios sí son plausibles y los rangos de PAX no dejan huecos: el motor de
 * precios elige el renglón por el número de invitados, y un hueco haría que la
 * demo tronara justo cuando alguien mueve el PAX enfrente de un prospecto.
 */

export interface CatalogoDemo {
  priceListId: string;
  espacios: { id: string; nombre: string; capacidad: number }[];
  tiposEvento: { id: string; nombre: string; slug: string }[];
  paquetes: { id: string; eventTypeId: string }[];
  banqueteros: { id: string; nombre: string }[];
}

/** Renta por rango de invitados. Tres salones, tres niveles de precio. */
const RENTA = {
  'Salón Jacarandas': [
    { min: 1, max: 100, viernes: 40_000, sabado: 46_000, domAJue: 34_000 },
    { min: 101, max: 200, viernes: 62_000, sabado: 70_000, domAJue: 54_000 },
    { min: 201, max: 350, viernes: 84_000, sabado: 94_000, domAJue: 74_000 },
  ],
  'Jardín Las Palmas': [
    { min: 1, max: 100, viernes: 44_000, sabado: 50_000, domAJue: 38_000 },
    { min: 101, max: 200, viernes: 68_000, sabado: 76_000, domAJue: 60_000 },
    { min: 201, max: 350, viernes: 92_000, sabado: 102_000, domAJue: 82_000 },
  ],
  'Terraza Mirador': [
    { min: 1, max: 150, viernes: 56_000, sabado: 64_000, domAJue: 48_000 },
    { min: 151, max: 350, viernes: 88_000, sabado: 98_000, domAJue: 78_000 },
    { min: 351, max: 700, viernes: 126_000, sabado: 140_000, domAJue: 112_000 },
  ],
} as const;

const CAPACIDAD: Record<keyof typeof RENTA, number> = {
  'Salón Jacarandas': 350,
  'Jardín Las Palmas': 350,
  'Terraza Mirador': 700,
};

/** Anticipo y complemento por salón, en la forma que espera el plan de pagos. */
const REGLA_PAGO: Record<keyof typeof RENTA, { anticipo: number; complementoPct: number }> = {
  'Salón Jacarandas': { anticipo: 5_000, complementoPct: 0.3 },
  'Jardín Las Palmas': { anticipo: 5_000, complementoPct: 0.3 },
  'Terraza Mirador': { anticipo: 10_000, complementoPct: 0.35 },
};

const TIPOS = [
  { nombre: 'Boda', slug: 'boda', dj: 3_000 },
  { nombre: 'XV Años', slug: 'xv-anos', dj: 2_800 },
  { nombre: 'Graduación', slug: 'graduacion', dj: 2_600 },
  { nombre: 'Bautizo', slug: 'bautizo', dj: 2_600 },
  { nombre: 'Corporativo', slug: 'corporativo', dj: 0 },
] as const;

/** Un paquete de alimentos por tipo de evento, con precio por persona por rango. */
const PAQUETES: Record<string, { nombre: string; incluye: string; precios: number[] }> = {
  boda: {
    nombre: 'Menú Boda Tres Tiempos',
    incluye: 'Entrada, plato fuerte, postre, refresco y hielo. Mantelería blanca.',
    precios: [780, 720, 680],
  },
  'xv-anos': {
    nombre: 'Menú XV Años',
    incluye: 'Entrada, plato fuerte, postre y refresco. Mantelería a elegir.',
    precios: [690, 640, 600],
  },
  graduacion: {
    nombre: 'Menú Graduación',
    incluye: 'Plato fuerte, postre y refresco.',
    precios: [520, 480, 450],
  },
  bautizo: {
    nombre: 'Menú Bautizo',
    incluye: 'Entrada, plato fuerte, postre y refresco.',
    precios: [610, 570, 540],
  },
  corporativo: {
    nombre: 'Coffee Break Corporativo',
    incluye: 'Café, panadería, fruta y agua durante toda la sesión.',
    precios: [330, 300, 280],
  },
};

/** Los mismos tres rangos para todos los paquetes: sin huecos y sin traslapes. */
const RANGOS_ALIMENTOS = [
  { min: 1, max: 100 },
  { min: 101, max: 250 },
  { min: 251, max: null },
];

const BANQUETEROS = [
  'Banquetes La Higuera',
  'Grupo Anfitrión',
  'Mesa Larga Catering',
  'Sabores del Valle',
  'Casa Olivo Eventos',
  'Banquetes Río Verde',
] as const;

const EMPLEADOS = [
  { nombre: 'Rosa Melgar' },
  { nombre: 'Isaac Peralta', rol: 'Jefe de área' },
  { nombre: 'Norma Sandoval' },
  { nombre: 'Julián Ordaz' },
  { nombre: 'Beatriz Cano' },
  { nombre: 'Tomás Rivera', rol: 'Suplente' },
] as const;

export async function sembrarCatalogoDemo(prisma: PrismaClient): Promise<CatalogoDemo> {
  const priceList = await prisma.priceList.create({
    data: {
      nombre: 'Demo 2027',
      anio: 2027,
      activa: true,
      ivaRate: 0.16,
      extraHourRate: 0.05,
      foodDiscountRate: 0.05,
      capillaSabado: 6_000,
    },
  });

  const espacios: CatalogoDemo['espacios'] = [];
  for (const nombre of Object.keys(RENTA) as (keyof typeof RENTA)[]) {
    const space = await prisma.space.create({
      data: { nombre, capacidadMax: CAPACIDAD[nombre] },
    });
    espacios.push({ id: space.id, nombre, capacidad: CAPACIDAD[nombre] });
    await prisma.rentalPrice.createMany({
      data: RENTA[nombre].map((r) => ({
        priceListId: priceList.id,
        spaceId: space.id,
        min: r.min,
        max: r.max,
        viernes: r.viernes,
        // El viernes especial es la mitad del viernes, igual que en el catálogo real.
        viernesEspecial: Math.round(r.viernes / 2),
        sabado: r.sabado,
        domAJue: r.domAJue,
      })),
    });
    await prisma.spacePaymentRule.create({
      data: { spaceId: space.id, ...REGLA_PAGO[nombre], liquidarDiasAntes: 30 },
    });
  }

  const tiposEvento: CatalogoDemo['tiposEvento'] = [];
  const paquetes: CatalogoDemo['paquetes'] = [];
  for (const t of TIPOS) {
    const eventType = await prisma.eventType.create({ data: { nombre: t.nombre, slug: t.slug } });
    tiposEvento.push({ id: eventType.id, nombre: t.nombre, slug: t.slug });

    // Un tipo SIN renglón de DJ simplemente no ofrece el servicio, igual que en
    // el catálogo real: el corporativo no lleva DJ.
    if (t.dj > 0) {
      await prisma.djHoraExtraPrice.create({
        data: { priceListId: priceList.id, eventTypeId: eventType.id, price: t.dj },
      });
    }

    const def = PAQUETES[t.slug]!;
    const paquete = await prisma.foodPackage.create({
      data: {
        eventTypeId: eventType.id,
        priceListId: priceList.id,
        nombre: def.nombre,
        incluye: def.incluye,
      },
    });
    paquetes.push({ id: paquete.id, eventTypeId: eventType.id });
    await prisma.foodPackagePrice.createMany({
      data: RANGOS_ALIMENTOS.map((r, i) => ({
        packageId: paquete.id,
        min: r.min,
        max: r.max,
        pricePerPerson: def.precios[i]!,
      })),
    });
  }

  await prisma.addOn.createMany({
    data: [
      { nombre: 'Mesa de dulces (por persona)', kind: 'porPersona', price: 120, priceListId: priceList.id },
      { nombre: 'Pista iluminada', kind: 'fijo', price: 14_000, priceListId: priceList.id },
      { nombre: 'Hora extra de barra', kind: 'porUnidad', price: 6_500, priceListId: priceList.id },
    ],
  });

  const banqueteros: CatalogoDemo['banqueteros'] = [];
  for (const [i, nombre] of BANQUETEROS.entries()) {
    const b = await prisma.banquetero.create({
      data: { nombre, telefono: `99812345${String(i).padStart(2, '0')}` },
    });
    banqueteros.push({ id: b.id, nombre });
  }

  const empleados = [];
  for (const e of EMPLEADOS) {
    empleados.push(await prisma.empleado.create({ data: e }));
  }
  await prisma.cuadrilla.create({
    data: {
      nombre: 'Cuadrilla Demo',
      miembros: { create: empleados.slice(0, 4).map((e) => ({ empleadoId: e.id })) },
    },
  });

  return {
    priceListId: priceList.id,
    espacios,
    tiposEvento,
    paquetes,
    banqueteros,
  };
}
