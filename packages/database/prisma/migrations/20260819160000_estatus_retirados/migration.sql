-- Punto 8 (13-ago-2026): se retiran `enviada`, `aceptada` y `vencida`.
-- Quedan `borrador`, `formalizada`, `complementada` y `liquidada`.
--
-- Postgres NO puede quitar un valor de un enum: no existe `DROP VALUE`. Hay que
-- crear un tipo nuevo, mover la columna y borrar el viejo. Y las filas se migran
-- ANTES del swap: el cast `::text::"QuoteStatus_new"` truena con
-- `invalid input value for enum` en cuanto se topa un valor que ya no existe.
--
-- Esto va como migración SQL y NO como backfill de TS a propósito: el `CMD` de
-- la imagen corre `migrate:deploy` COMPLETO antes de todos los backfills, así que
-- un backfill de TS correría cuando el valor retirado ya no existe y no
-- encontraría nada que mover.
--
-- Todo en UNA transacción: dejar las filas migradas con el tipo viejo (o al
-- revés) es peor que no haber corrido nada.
BEGIN;

-- Paso 1 · migrar las filas. Decisión del dueño: los tres estatus retirados
-- pasan a `borrador` — incluidas las 4 `vencida` que había en producción. Y con
-- ellas se va el vencimiento automático completo (ver `expireStaleQuotes`,
-- eliminada en este mismo cambio).
UPDATE "Quote" SET "status" = 'borrador'
 WHERE "status" IN ('enviada', 'aceptada', 'vencida');

-- Paso 2 · el tipo nuevo, con los cuatro que quedan.
CREATE TYPE "QuoteStatus_new" AS ENUM ('borrador', 'formalizada', 'complementada', 'liquidada');

-- Paso 3 · mover la columna. El `DROP DEFAULT` es obligatorio antes del cast:
-- el default está tipado con el enum viejo. El índice `Quote_status_idx` lo
-- reconstruye Postgres solo.
ALTER TABLE "public"."Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE "QuoteStatus_new" USING ("status"::text::"QuoteStatus_new");
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'borrador';

-- Paso 4 · borrar el tipo viejo y quedarse con el nombre.
ALTER TYPE "QuoteStatus" RENAME TO "QuoteStatus_old";
ALTER TYPE "QuoteStatus_new" RENAME TO "QuoteStatus";
DROP TYPE "public"."QuoteStatus_old";

COMMIT;
