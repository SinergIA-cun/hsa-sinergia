import { describe, it, expect } from 'vitest';
import { Prisma } from '@hsa/database';
import { TABLAS_CATALOGO, TABLAS_MOVIMIENTO, TABLAS_NUNCA } from './purga.js';

/**
 * Sin base de datos: compara las listas de la purga contra los modelos del
 * esquema. Una tabla nueva que nadie clasificó hace que el `TRUNCATE` del demo
 * truene con "cannot truncate a table referenced in a foreign key constraint".
 */
describe('purga: cobertura del esquema', () => {
  const listadas = [...TABLAS_MOVIMIENTO, ...TABLAS_CATALOGO, ...TABLAS_NUNCA] as string[];

  it('cada modelo del esquema está en exactamente una lista', () => {
    const modelos = Object.values(Prisma.ModelName) as string[];
    const sinClasificar = modelos.filter((m) => !listadas.includes(m));
    expect(sinClasificar).toEqual([]);
  });

  it('ninguna tabla aparece en dos listas ni es un modelo inexistente', () => {
    const modelos = Object.values(Prisma.ModelName) as string[];
    expect(new Set(listadas).size).toBe(listadas.length);
    expect(listadas.filter((t) => !modelos.includes(t))).toEqual([]);
  });
});
