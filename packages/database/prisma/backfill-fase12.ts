import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Saca el valet del cobro: todos los eventos lo tienen y el cliente lo paga
 * directo al valet en el evento ($100 por auto). Se DESACTIVA en vez de
 * borrarse porque las cotizaciones ya emitidas lo referencian por id en su
 * desglose congelado. Idempotente.
 */
async function main(): Promise<void> {
  const { count } = await prisma.addOn.updateMany({
    where: { nombre: { contains: 'alet' }, activo: true },
    data: { activo: false },
  });
  console.log(count > 0 ? `Valet desactivado (${count} add-on).` : 'Valet ya estaba desactivado.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('backfill-fase12 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
