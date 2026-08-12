-- Tipo de bitácora para "un admin movió la cotización a otro catálogo".
--
-- `LogTipo` es unión de TypeScript **y** enum `ActivityType` de Postgres, y
-- `logActivity` se traga sus errores (`catch {}`) a propósito: la bitácora no
-- debe tumbar la operación. Sin este ALTER TYPE, el movimiento se ejecutaría y
-- se quedaría SIN RASTRO, y el typecheck no vería nada raro. Lo único que caza
-- ese hueco es el test que cuenta los registros de tipo 'catalogo'.
--
-- Va SOLO en su propia migración: Postgres permite agregar el valor dentro de
-- una transacción (PG12+), pero no usarlo en la misma. Mezclarlo con cualquier
-- sentencia que lo referencie haría fallar la migración.
--
-- `IF NOT EXISTS` para que re-aplicar sobre una base ya parchada a mano no falle.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'catalogo';

-- NOTA: se quitó a mano el bloque que Prisma vuelve a meter en cada diff —
-- `DROP SEQUENCE client_ref_seq` y `DROP SEQUENCE recibo_folio_seq`. Es deriva
-- histórica del esquema (los defaults son `dbgenerated`), no un cambio de este
-- plan, y ejecutarlo rompería el folio de recibos y el número de cliente.
