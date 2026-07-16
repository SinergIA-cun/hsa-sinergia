import type { PrismaClient } from '@prisma/client';

// Banqueteros conocidos (tomados de las hojas operativas de la hacienda). El
// cliente puede agregar/editar más desde el panel de administración.
const BANQUETEROS = ['Carlos Barrera', 'Prestige', 'Succes', 'Cautiva', 'Prom'];

/** Crea (idempotente, por nombre) los banqueteros base si aún no existen. */
export async function applyBanqueteros(prisma: PrismaClient): Promise<void> {
  for (const nombre of BANQUETEROS) {
    const existe = await prisma.banquetero.findFirst({ where: { nombre } });
    if (!existe) await prisma.banquetero.create({ data: { nombre } });
  }
}
