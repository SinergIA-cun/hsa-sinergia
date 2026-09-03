import type { PrismaClient } from '@hsa/database';

/**
 * Vaciado de datos. Lo usan DOS guiones con intenciones distintas:
 *
 *  · `purgar-datos.ts` — entregar la app al cliente sin los datos de prueba,
 *    conservando lo que ya cargó de su operación (catálogo, banqueteros,
 *    personal, usuarios).
 *  · `seed-demo.ts` — dejar el demo de ventas en su estado bonito otra vez
 *    después de que un prospecto lo dejó sucio. Ese sí borra el catálogo, porque
 *    siembra el suyo.
 *
 * NUNCA va en la cadena de arranque del contenedor. Los backfills son
 * idempotentes y no pierden nada si corren de más; esto pierde todo.
 */

/**
 * Las tablas de MOVIMIENTO, de PADRES a HIJOS.
 *
 * Al vaciar el orden da igual —van todas en un solo `TRUNCATE`, y si faltara
 * una tabla que referencia a otra de la lista Postgres truena en vez de dejar
 * filas huérfanas, que es justo la falla que se quiere—. Pero al RESTAURAR el
 * orden lo es todo: insertar un `Payment` antes de su `Quote` viola la llave
 * foránea. Una sola lista en el orden que sirve para las dos cosas, en vez de
 * dos listas que se desincronizan.
 *
 * Si se agrega una tabla, va DESPUÉS de todas las que referencia.
 */
export const TABLAS_MOVIMIENTO = [
  'Client',
  'PriceListAudit',
  'Quote',
  'QuoteExtra',
  'ActivityLog',
  'EventoHistorico',
  'PagoBanquetero',
  'Payment',
  'ApartadoFecha',
  'AbonoApartado',
] as const;

/**
 * El CATÁLOGO y la gente. Lo que el cliente ya cargó de su operación real y no
 * se toca al entregar. `seed-demo.ts` sí las vacía, con `incluirCatalogo`.
 *
 * Mismo criterio que arriba: de PADRES a HIJOS, para que un día se puedan
 * restaurar sin pelearse con las llaves foráneas.
 */
export const TABLAS_CATALOGO = [
  'PriceList',
  'Space',
  'EventType',
  'Banquetero',
  'Empleado',
  'User',
  'FoodPackage',
  'RentalPrice',
  'FoodPackagePrice',
  'AddOn',
  'DjHoraExtraPrice',
  'SpacePaymentRule',
  'Cuadrilla',
  'CuadrillaMiembro',
] as const;

/**
 * Los folios que vuelven a empezar. No son `serial` de una columna: son
 * secuencias sueltas que las columnas consumen con `nextval`, así que
 * `RESTART IDENTITY` no las alcanza y hay que reiniciarlas a mano.
 *
 * Reiniciar el folio del recibo solo es correcto porque los pagos se van con la
 * purga: no queda ningún recibo impreso con el que un folio 1 pudiera choocar.
 */
export const SECUENCIAS = ['recibo_folio_seq', 'client_ref_seq'] as const;

export interface CensoTabla {
  tabla: string;
  filas: number;
}

/** Cuántas filas hay hoy en cada tabla, para poder decir qué se borró. */
export async function censo(db: PrismaClient, tablas: readonly string[]): Promise<CensoTabla[]> {
  const filas: CensoTabla[] = [];
  for (const tabla of tablas) {
    const conteo = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "${tabla}"`,
    );
    filas.push({ tabla, filas: Number(conteo[0]?.n ?? 0) });
  }
  return filas;
}

export interface OpcionesPurga {
  /** Vaciar TAMBIÉN el catálogo y la gente. Solo el demo lo usa. */
  incluirCatalogo?: boolean;
  /** Qué dejar escrito en la bitácora forense sobre esta purga. */
  motivo: string;
}

export interface ResultadoPurga {
  antes: CensoTabla[];
  borradas: number;
  auditoriaBorrada: number;
}

/**
 * Vacía las tablas y deja UN renglón en la bitácora forense contando lo que
 * pasó.
 *
 * La bitácora se purga también —si no, quedan miles de renglones de "DELETE"
 * describiendo los datos que se acaban de borrar, que es justo lo que el cliente
 * no debería heredar— pero no se queda muda: el renglón que se escribe al final
 * dice cuántas filas se fueron de cada tabla, quién y cuándo. Un vaciado masivo
 * es exactamente el tipo de movimiento que la bitácora existe para contar.
 */
export async function purgar(db: PrismaClient, opts: OpcionesPurga): Promise<ResultadoPurga> {
  const tablas = [...TABLAS_MOVIMIENTO, ...(opts.incluirCatalogo ? TABLAS_CATALOGO : [])];
  const antes = await censo(db, tablas);

  // Un solo TRUNCATE: es atómico, no deja a la base a medio vaciar si algo
  // truena, y dispara UN trigger por tabla en vez de uno por fila.
  const lista = tablas.map((t) => `"${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY`);

  for (const seq of SECUENCIAS) {
    await db.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 1`);
  }

  // La bitácora se borra y se vuelve a sembrar con el resumen, en UNA
  // transacción: `set_config(..., TRUE)` vive solo dentro de ella, y ese
  // interruptor es lo único que deja borrar la bitácora.
  const resumen = {
    motivo: opts.motivo,
    incluyoCatalogo: opts.incluirCatalogo === true,
    filasPorTabla: Object.fromEntries(antes.map((c) => [c.tabla, c.filas])),
  };
  const [, auditoriaBorrada] = await db.$transaction([
    db.$executeRaw`SELECT set_config('app.purga_auditoria', 'si', TRUE)`,
    db.$executeRaw`DELETE FROM "AuditoriaDb"`,
    db.$executeRaw`
      INSERT INTO "AuditoriaDb" ("tabla", "operacion", "despues", "aplicacion")
      VALUES ('AuditoriaDb', 'PURGA', ${JSON.stringify(resumen)}::jsonb,
              current_setting('application_name', true))`,
  ]);

  return {
    antes,
    borradas: antes.reduce((s, c) => s + c.filas, 0),
    auditoriaBorrada,
  };
}
