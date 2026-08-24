import type { PrismaClient } from '@hsa/database';

export interface ResultadoMantenimiento {
  /** Tablas a las que se les acaba de poner el trigger (0 en un arranque normal). */
  tablasEnganchadas: number;
  /** Renglones viejos purgados por la política de retención. */
  purgados: number;
}

/**
 * Mantenimiento de la bitácora forense al arrancar.
 *
 * Hace dos cosas, las dos idempotentes:
 *
 * 1. **Engancha el trigger a las tablas que no lo tengan.** La migración lo puso
 *    en las tablas de ese día, pero una migración futura puede crear una tabla
 *    nueva y nadie se acordará de auditarla. Correr esto en cada arranque cierra
 *    ese hueco sin depender de la memoria de nadie.
 * 2. **Purga lo que ya cumplió su retención.** El `jsonb` de un UPDATE guarda la
 *    fila completa dos veces; sin poda la tabla crece sin techo.
 *
 * No hay planificador en este despliegue —los trabajos solo corren al arrancar
 * el contenedor—, así que este es el único momento en que puede pasar.
 */
export async function mantenimientoAuditoria(
  db: PrismaClient,
  retencionDias: number,
): Promise<ResultadoMantenimiento> {
  const filas = await db.$queryRaw<{ asegurar_auditoria: number }[]>`SELECT asegurar_auditoria()`;
  const enganchadas = filas[0]?.asegurar_auditoria ?? 0;

  // La bitácora es de solo escritura: un trigger rechaza cualquier DELETE que no
  // venga anunciado. La purga tiene que decirlo en voz alta, y `SET LOCAL` solo
  // existe dentro de una transacción — de ahí el lote.
  const [, purgados] = await db.$transaction([
    db.$executeRaw`SELECT set_config('app.purga_auditoria', 'si', TRUE)`,
    // El `::int` no sobra: Prisma manda los números como bigint y
    // `make_interval(days => bigint)` no existe. Sin el casteo, la purga truena
    // en cada arranque del contenedor.
    db.$executeRaw`DELETE FROM "AuditoriaDb" WHERE "createdAt" < now() - make_interval(days => ${retencionDias}::int)`,
  ]);

  return { tablasEnganchadas: Number(enganchadas), purgados: Number(purgados) };
}
