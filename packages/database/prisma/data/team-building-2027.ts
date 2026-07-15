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

/** Reemplaza las filas de renta de un espacio en una lista dada (idempotente). */
async function setRentalRows(
  prisma: PrismaClient,
  priceListId: string,
  spaceId: string,
  rows: FlatRow[],
) {
  await prisma.rentalPrice.deleteMany({ where: { priceListId, spaceId } });
  await prisma.rentalPrice.createMany({
    data: rows.map((r) => ({ priceListId, spaceId, min: r.min, max: r.max, ...flatCols(r.precio) })),
  });
}

/**
 * Aplica la renta plana de Team Building de forma idempotente:
 *  - Crea los espacios Los Balcones y Los Pajaritos.
 *  - Crea/actualiza una lista de precios "plano" con TODOS los espacios en flat.
 *  - Agrega Balcones/Pajaritos a la lista "dia" (precio plano en las 4 columnas),
 *    para que se puedan cotizar en cualquier evento.
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

  // Lista de precios PLANA (Team Building). Se busca/crea por tipo.
  const flatList =
    (await prisma.priceList.findFirst({ where: { tipo: 'plano', anio: 2027 } })) ??
    (await prisma.priceList.create({ data: { anio: 2027, activa: false, tipo: 'plano' } }));

  await setRentalRows(prisma, flatList.id, cupula.id, CUPULA_FLAT);
  await setRentalRows(prisma, flatList.id, arcos.id, ARCOS_CAMPOS_FLAT);
  await setRentalRows(prisma, flatList.id, campos.id, ARCOS_CAMPOS_FLAT);
  await setRentalRows(prisma, flatList.id, balcones.id, BALCONES_FLAT);
  await setRentalRows(prisma, flatList.id, pajaritos.id, PAJARITOS_FLAT);

  // Balcones/Pajaritos también en la lista "dia" (precio plano) para eventos normales.
  const diaList = await prisma.priceList.findFirst({ where: { tipo: 'dia', activa: true } });
  if (diaList) {
    await setRentalRows(prisma, diaList.id, balcones.id, BALCONES_FLAT);
    await setRentalRows(prisma, diaList.id, pajaritos.id, PAJARITOS_FLAT);
  }
}
