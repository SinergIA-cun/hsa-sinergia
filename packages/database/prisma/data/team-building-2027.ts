import type { PrismaClient } from '@prisma/client';

// Team Building 2027: renta PLANA (un precio por capacidad, igual todos los días)
// + dos espacios nuevos (Los Balcones, Los Pajaritos). Transcrito de TB.pdf.
// Los espacios nuevos se cotizan SIEMPRE con precio plano (para cualquier evento);
// los espacios existentes usan la tabla plana solo cuando el evento es Team Building.
// Todos los precios son CON IVA (como el resto de la renta).

interface FlatRow {
  min: number;
  max: number | null;
  precio: number; // plano, con IVA
}

// Tabla plana por espacio (RENTA 2027 del folleto de Team Building).
const CUPULA_FLAT: FlatRow[] = [
  { min: 1, max: 50, precio: 17250 },
  { min: 51, max: 100, precio: 35000 },
  { min: 101, max: 200, precio: 43000 },
  { min: 201, max: 300, precio: 50000 },
  { min: 301, max: 400, precio: 58250 },
  { min: 401, max: 500, precio: 85000 },
  { min: 501, max: 600, precio: 98750 },
];
const ARCOS_CAMPOS_FLAT: FlatRow[] = [
  { min: 1, max: 50, precio: 17250 },
  { min: 51, max: 100, precio: 35000 },
  { min: 101, max: 200, precio: 43000 },
  { min: 201, max: 300, precio: 50000 },
  { min: 301, max: 400, precio: 58250 },
];
const BALCONES_FLAT: FlatRow[] = [
  { min: 1, max: 50, precio: 9000 },
  { min: 51, max: 70, precio: 15500 },
];
const PAJARITOS_FLAT: FlatRow[] = [{ min: 1, max: 50, precio: 9000 }];

/** Convierte un precio plano a las 4 columnas por-día (todas iguales). */
function flatCols(precio: number) {
  return { viernes: precio, viernesEspecial: precio, sabado: precio, domAJue: precio };
}

async function findSpace(prisma: PrismaClient, nombre: string) {
  return prisma.space.findFirst({ where: { nombre } });
}

/** Crea el espacio si no existe (por nombre) y lo devuelve activo. */
async function ensureSpace(prisma: PrismaClient, nombre: string, capacidadMax: number) {
  const existing = await findSpace(prisma, nombre);
  if (existing) {
    if (!existing.activo) await prisma.space.update({ where: { id: existing.id }, data: { activo: true } });
    return existing;
  }
  return prisma.space.create({ data: { nombre, capacidadMax, activo: true } });
}

/**
 * Reemplaza las filas de renta de un espacio en un catálogo, para UN tipo de
 * renta (idempotente).
 *
 * `tipo` es obligatorio y entra también en el `deleteMany`: la renta por día y la
 * plana viven en el MISMO catálogo desde el catálogo versionado, así que borrar
 * por (catálogo, espacio) a secas se llevaría de paso las filas del otro tipo.
 */
async function setRentalRows(
  prisma: PrismaClient,
  priceListId: string,
  spaceId: string,
  tipo: 'dia' | 'plano',
  rows: FlatRow[],
) {
  await prisma.rentalPrice.deleteMany({ where: { priceListId, spaceId, tipo } });
  await prisma.rentalPrice.createMany({
    data: rows.map((r) => ({ priceListId, spaceId, tipo, min: r.min, max: r.max, ...flatCols(r.precio) })),
  });
}

/**
 * Aplica la renta plana de Team Building de forma idempotente:
 *  - Crea los espacios Los Balcones y Los Pajaritos.
 *  - Escribe la renta plana de TODOS los espacios en el catálogo activo, en los
 *    renglones marcados `tipo: 'plano'`.
 *  - Agrega Balcones/Pajaritos también a los renglones `tipo: 'dia'` (con el
 *    mismo precio en las 4 columnas), para que se coticen en cualquier evento.
 *
 * Antes esto vivía en una SEGUNDA PriceList con `tipo: 'plano'`, que quedaba
 * fuera del filtro `activa` y obligaba a dos listas por año. Con el catálogo
 * versionado hay UN catálogo por año y el tipo vive en el renglón.
 *
 * NOTA: no define reglas de pago (SpacePaymentRule) para Balcones/Pajaritos;
 * quedan como "plan pendiente" hasta que el cliente indique el anticipo.
 */
export async function applyTeamBuilding2027(prisma: PrismaClient): Promise<void> {
  const arcos = await findSpace(prisma, 'Salón Los Arcos');
  const campos = await findSpace(prisma, 'Jardín Los Campos');
  const cupula = await findSpace(prisma, 'Jardín La Cúpula');
  if (!arcos || !campos || !cupula) {
    throw new Error('Faltan espacios base (Arcos/Campos/Cúpula); corre el seed primero.');
  }
  const balcones = await ensureSpace(prisma, 'Salón Los Balcones', 70);
  const pajaritos = await ensureSpace(prisma, 'Salón Los Pajaritos', 50);

  const catalogo = await prisma.priceList.findFirst({ where: { activa: true }, orderBy: { anio: 'desc' } });
  if (!catalogo) throw new Error('No hay catálogo (PriceList) activo al que colgar la renta plana.');

  for (const [spaceId, rows] of [
    [cupula.id, CUPULA_FLAT],
    [arcos.id, ARCOS_CAMPOS_FLAT],
    [campos.id, ARCOS_CAMPOS_FLAT],
    [balcones.id, BALCONES_FLAT],
    [pajaritos.id, PAJARITOS_FLAT],
  ] as const) {
    await setRentalRows(prisma, catalogo.id, spaceId, 'plano', rows);
  }

  // Balcones/Pajaritos también en la renta por-día (precio plano) para eventos normales.
  await setRentalRows(prisma, catalogo.id, balcones.id, 'dia', BALCONES_FLAT);
  await setRentalRows(prisma, catalogo.id, pajaritos.id, 'dia', PAJARITOS_FLAT);
}
