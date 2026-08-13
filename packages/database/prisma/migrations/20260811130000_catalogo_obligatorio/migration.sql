-- Fase 2 del catálogo versionado: el catálogo se vuelve obligatorio y muere el
-- singleton PricingConfig, la última fuente global capaz de represiar TODA
-- cotización al reeditarla.
--
-- Depende de que 20260811125000_catalogo_backfill ya haya fundido los datos: los
-- SET NOT NULL de aquí abajo fallan sobre cualquier fila huérfana. Si alguno
-- falla, el problema es el backfill — no forzar esta migración.
--
-- `PriceList.tipo` se dropea AQUÍ y no en la fase 1 justamente porque el backfill
-- lo lee para copiarlo a los renglones de "RentalPrice".
--
-- Igual que en la fase 1, NO va el DROP SEQUENCE de client_ref_seq /
-- recibo_folio_seq que Prisma mete en el diff: es deriva histórica, no un cambio
-- de este plan, y ejecutarlo rompería el folio de recibos.

-- Los FK pasan de SET NULL a RESTRICT: un catálogo en uso no se puede borrar.
ALTER TABLE "AddOn" DROP CONSTRAINT "AddOn_priceListId_fkey";
ALTER TABLE "FoodPackage" DROP CONSTRAINT "FoodPackage_priceListId_fkey";
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_priceListId_fkey";

-- AlterTable
ALTER TABLE "AddOn" ALTER COLUMN "priceListId" SET NOT NULL;

-- AlterTable
ALTER TABLE "FoodPackage" ALTER COLUMN "priceListId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Quote" ALTER COLUMN "priceListId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PriceList" DROP COLUMN "tipo",
ALTER COLUMN "nombre" SET NOT NULL;

-- DropTable
DROP TABLE "PricingConfig";

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPackage" ADD CONSTRAINT "FoodPackage_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
