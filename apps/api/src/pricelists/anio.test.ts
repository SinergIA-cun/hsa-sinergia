import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { anioDelNombre, clonarCatalogo } from './service.js';

/** El año del catálogo ya no se pide (16-oct-2026): sale del nombre o es el año en curso. */

const NOMBRE = `Precios 2093 prueba-anio`;
afterAll(async () => {
  const c = await prisma.priceList.findUnique({ where: { nombre: NOMBRE } });
  if (c) {
    await prisma.rentalPrice.deleteMany({ where: { priceListId: c.id } });
    await prisma.priceList.delete({ where: { id: c.id } });
  }
});

describe('año del catálogo', () => {
  it('se toma del nombre o es el año en curso', () => {
    expect(anioDelNombre('2028')).toBe(2028);
    expect(anioDelNombre('Precios 2029 temporada alta')).toBe(2029);
    expect(anioDelNombre('Temporada alta', new Date('2026-10-16T12:00:00Z'))).toBe(2026);
  });

  it('se crea desde cero sin mandar año', async () => {
    const c = await clonarCatalogo(prisma, { nombre: NOMBRE });
    expect(c.anio).toBe(2093);
    expect(c.activa).toBe(false);
  });
});
