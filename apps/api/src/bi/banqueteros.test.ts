import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { conciliarBanqueteros, importarBanqueteros } from './banqueteros.js';

/**
 * El BI da de alta a sus banqueteros (C4). Lo que se protege: idempotencia por
 * nombre normalizado, que nunca se toque uno que ya existe y que un nombre
 * ambiguo no se adivine.
 */

const SUF = randomUUID().slice(0, 6);
const nombre = (n: string) => `${n} ${SUF}`;

afterAll(async () => {
  await prisma.banquetero.deleteMany({ where: { nombre: { contains: SUF } } });
});

describe('importar banqueteros del BI', () => {
  it('conciliar no escribe; importar crea los nuevos y reporta los que ya existían', async () => {
    const yaEstaba = await prisma.banquetero.create({ data: { nombre: nombre('Carlos Barrera'), telefono: '5512340000' } });
    const lote = { banqueteros: [{ nombre: nombre('Salvador Tenorio') }, { nombre: nombre('CARLOS BARRERA.') }] };

    const c = await conciliarBanqueteros(prisma, lote);
    expect(c.resultados.map((r) => r.estado)).toEqual(['nuevo', 'existe']);
    expect(await prisma.banquetero.count({ where: { nombre: nombre('Salvador Tenorio') } })).toBe(0);

    const i = await importarBanqueteros(prisma, lote);
    expect(i.resumen).toEqual({ creado: 1, existe: 1 });
    expect(i.resultados[1]).toMatchObject({ estado: 'existe', id: yaEstaba.id });
    // El que ya estaba no se toca.
    expect((await prisma.banquetero.findUniqueOrThrow({ where: { id: yaEstaba.id } })).telefono).toBe('5512340000');

    // Idempotente: la segunda vez todo existe.
    const otra = await importarBanqueteros(prisma, lote);
    expect(otra.resumen).toEqual({ existe: 2 });
  });

  it('el mismo nombre dos veces en el lote es UN banquetero', async () => {
    const r = await importarBanqueteros(prisma, {
      banqueteros: [{ nombre: nombre('Víctor González') }, { nombre: nombre('VICTOR GONZALEZ') }],
    });
    expect(r.resultados.map((x) => x.estado)).toEqual(['creado', 'existe']);
    expect(r.resultados[1]!.id).toBe(r.resultados[0]!.id);
  });

  it('un nombre que coincide con dos de aquí no se adivina ni se crea', async () => {
    await prisma.banquetero.createMany({ data: [{ nombre: nombre('Omar Diosdado') }, { nombre: nombre('omar  diosdado') }] });
    const r = await importarBanqueteros(prisma, { banqueteros: [{ nombre: nombre('Omar Diosdado') }] });
    expect(r.resultados[0]).toMatchObject({ estado: 'ambiguo', id: null });
    expect(r.resultados[0]!.coincidencias).toHaveLength(2);
    expect(await prisma.banquetero.count({ where: { nombre: { contains: 'iosdado' }, AND: { nombre: { contains: SUF } } } })).toBe(2);
  });

  it('un lote vacío o de más de 200 se rechaza entero', async () => {
    await expect(importarBanqueteros(prisma, { banqueteros: [] })).rejects.toThrow();
    const muchos = Array.from({ length: 201 }, (_, k) => ({ nombre: nombre(`B${k}`) }));
    await expect(importarBanqueteros(prisma, { banqueteros: muchos })).rejects.toThrow();
  });
});
