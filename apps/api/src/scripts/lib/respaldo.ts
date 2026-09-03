import type { PrismaClient } from '@hsa/database';

/**
 * Respaldo DENTRO de la misma base, en un esquema aparte.
 *
 * Nació de un problema práctico: `pg_dump` no existe en ninguna de las consolas
 * de EasyPanel a las que se llega desde el navegador —el contenedor de la API es
 * `node:24-slim` y no trae cliente de Postgres— así que "respalda antes de
 * vaciar" era un consejo que no se podía seguir. Esto sí: es SQL puro sobre la
 * conexión que ya existe.
 *
 * Qué protege y qué no, dicho claro:
 *  · SÍ protege de "vacié y me arrepentí": las filas siguen ahí, en otro
 *    esquema, y `restaurar()` las devuelve.
 *  · NO protege de que se muera el disco ni de que alguien borre la base
 *    completa. Para eso hace falta una copia FUERA del servidor —la pestaña
 *    Backups del servicio de Postgres, o un `pg_dump` desde el VPS.
 *
 * Los esquemas de respaldo no llevan índices, llaves foráneas ni triggers: son
 * una foto de las filas, que es exactamente lo que se necesita para devolverlas.
 * Tampoco los alcanza la bitácora forense: `asegurar_auditoria()` solo engancha
 * triggers al esquema de trabajo.
 */

/** Las secuencias que hay que reacomodar al restaurar, y de dónde sale su tope. */
const SECUENCIAS_A_REACOMODAR: { seq: string; tabla: string; columna: string }[] = [
  { seq: 'recibo_folio_seq', tabla: 'Payment', columna: 'folio' },
  { seq: 'client_ref_seq', tabla: 'Client', columna: 'numeroReferencia' },
  { seq: 'AuditoriaDb_id_seq', tabla: 'AuditoriaDb', columna: 'id' },
];

/** La bitácora forense necesita trato aparte al restaurar. Ver `restaurar()`. */
const BITACORA = 'AuditoriaDb';

/** Cualquier cliente de Prisma que sirva para SQL crudo (el normal o el de una transacción). */
type EjecutorSql = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRaw'>;

async function insertar(
  tx: EjecutorSql,
  esquema: string,
  destino: string,
  tabla: string,
): Promise<number> {
  return tx.$executeRawUnsafe(
    `INSERT INTO "${destino}"."${tabla}" SELECT * FROM "${esquema}"."${tabla}"`,
  );
}

async function reacomodar(tx: EjecutorSql, destino: string, tabla: string): Promise<void> {
  const s = SECUENCIAS_A_REACOMODAR.find((x) => x.tabla === tabla);
  if (!s) return;
  await tx.$executeRawUnsafe(
    `SELECT setval('"${s.seq}"', COALESCE((SELECT max("${s.columna}") FROM "${destino}"."${tabla}"), 0) + 1, false)`,
  );
}

export interface Respaldo {
  esquema: string;
  creado: Date;
  filas: number;
}

async function esquemaDeTrabajo(db: PrismaClient): Promise<string> {
  const r = await db.$queryRaw<{ s: string }[]>`SELECT current_schema() AS s`;
  return r[0]!.s;
}

/**
 * Copia las tablas a un esquema nuevo con la fecha en el nombre, y devuelve
 * cómo se llamó. Dos respaldos del mismo minuto no se pisan: el segundo lleva
 * sufijo.
 */
export async function crearRespaldo(
  db: PrismaClient,
  tablas: readonly string[],
): Promise<Respaldo> {
  const origen = await esquemaDeTrabajo(db);
  const sello = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '');
  let esquema = `respaldo_${sello}`;
  for (let n = 2; await existe(db, esquema); n++) esquema = `respaldo_${sello}_${n}`;

  await db.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  let filas = 0;
  for (const t of tablas) {
    // `CREATE TABLE AS` conserva el ORDEN de las columnas, que es de lo que
    // depende el `INSERT … SELECT *` de la restauración.
    filas += await db.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."${t}" AS SELECT * FROM "${origen}"."${t}"`,
    );
  }
  // Queda apuntado para qué era, por si alguien lo encuentra dentro de un año.
  await db.$executeRawUnsafe(
    `COMMENT ON SCHEMA "${esquema}" IS 'Respaldo automático previo a purgar-datos.ts'`,
  );
  return { esquema, creado: new Date(), filas };
}

async function existe(db: PrismaClient, esquema: string): Promise<boolean> {
  const r = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM information_schema.schemata WHERE schema_name = ${esquema}`;
  return Number(r[0]!.n) > 0;
}

/** Los respaldos que hay hoy, del más nuevo al más viejo. */
export async function listarRespaldos(db: PrismaClient): Promise<{ esquema: string; tablas: number }[]> {
  return db.$queryRaw<{ esquema: string; tablas: number }[]>`
    SELECT s.schema_name AS esquema,
           (SELECT count(*)::int FROM information_schema.tables t
             WHERE t.table_schema = s.schema_name) AS tablas
      FROM information_schema.schemata s
     WHERE s.schema_name LIKE 'respaldo\\_%'
     ORDER BY s.schema_name DESC`;
}

/**
 * Devuelve las filas de un respaldo a las tablas de trabajo.
 *
 * Vacía primero: restaurar encima de filas nuevas choocaría en las llaves
 * primarias, y adivinar cuáles conservar sería peor que decir que no.
 *
 * ADVERTENCIA HONESTA: si entre el respaldo y la restauración corrió una
 * migración que agregó o quitó columnas, el `SELECT *` ya no cuadra y esto
 * truena. Un respaldo así sirve para arrepentirse el mismo día, no para viajar
 * al pasado.
 */
export async function restaurar(
  db: PrismaClient,
  esquema: string,
  tablas: readonly string[],
): Promise<number> {
  if (!(await existe(db, esquema))) throw new Error(`No existe el respaldo "${esquema}"`);
  const destino = await esquemaDeTrabajo(db);
  const movimiento = tablas.filter((t) => t !== BITACORA);
  const lista = movimiento.map((t) => `"${destino}"."${t}"`).join(', ');

  let filas = 0;
  // Todo en UNA transacción: si algo truena a la mitad, la base no se queda ni
  // con lo viejo ni con lo nuevo. Probado — el primer intento de esto falló por
  // llaves foráneas y las tablas quedaron intactas.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.purga_auditoria', 'si', TRUE)`;
    await tx.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY`);

    if (tablas.includes(BITACORA)) {
      // El TRUNCATE de arriba disparó los triggers de la bitácora: cada tabla
      // truncada dejó su renglón, y esos renglones se quedaron con los ids 1, 2,
      // 3… los mismos que trae el respaldo. Se van antes de devolverlo.
      await tx.$executeRawUnsafe(`DELETE FROM "${destino}"."${BITACORA}"`);
      await tx.$executeRawUnsafe(`ALTER SEQUENCE "AuditoriaDb_id_seq" RESTART WITH 1`);
      filas += await insertar(tx, esquema, destino, BITACORA);
      await reacomodar(tx, destino, BITACORA);
    }

    for (const t of movimiento) {
      filas += await insertar(tx, esquema, destino, t);
      // La secuencia se reacomoda EN CUANTO se restaura su tabla: los folios
      // tienen que quedar por ENCIMA de lo devuelto, o el siguiente recibo
      // reestrenaría un folio ya impreso.
      await reacomodar(tx, destino, t);
    }
  });
  return filas;
}

/** Borra un respaldo. Se usa desde la consola cuando ya no hace falta. */
export async function borrarRespaldo(db: PrismaClient, esquema: string): Promise<void> {
  if (!esquema.startsWith('respaldo_')) {
    throw new Error(`"${esquema}" no parece un esquema de respaldo; no se toca.`);
  }
  await db.$executeRawUnsafe(`DROP SCHEMA "${esquema}" CASCADE`);
}
