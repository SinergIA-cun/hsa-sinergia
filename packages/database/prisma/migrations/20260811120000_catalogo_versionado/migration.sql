-- Fase 1 del catálogo versionado. TODAS las columnas nuevas nacen nullable o con
-- DEFAULT: la migración tiene que pasar sobre los datos que ya están en producción.
--
-- Lo que NO va aquí (va en la fase 2, después del backfill fase13):
--   · DROP COLUMN "tipo" en "PriceList" — el backfill lo lee para copiarlo a los
--     renglones de "RentalPrice". Dropearlo antes pierde qué renta es plana.
--   · Los SET NOT NULL de los priceListId nuevos.
--   · DROP TABLE "PricingConfig".
--
-- Tampoco va el DROP SEQUENCE de client_ref_seq / recibo_folio_seq que Prisma
-- mete en el diff: es deriva histórica de los `dbgenerated("nextval(...)")` de
-- 20260710163602_ref_folio_comprobante, no un cambio de este plan. Ejecutarlo
-- rompería el folio de recibos y el número de referencia del cliente.

-- El catálogo absorbe los parámetros de precio del singleton PricingConfig.
ALTER TABLE "PriceList" ADD COLUMN     "nombre" TEXT,
ADD COLUMN     "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 0.16,
ADD COLUMN     "extraHourRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
ADD COLUMN     "foodDiscountRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
ADD COLUMN     "capillaSabado" INTEGER NOT NULL DEFAULT 5000,
ALTER COLUMN "activa" SET DEFAULT false;

-- `tipo` baja de la lista al renglón: UN catálogo con renta por día Y renta plana.
ALTER TABLE "RentalPrice" ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'dia';

-- Servicios, paquetes de alimentos y cotizaciones se casan al catálogo.
ALTER TABLE "AddOn" ADD COLUMN     "priceListId" TEXT;
ALTER TABLE "FoodPackage" ADD COLUMN     "priceListId" TEXT;
ALTER TABLE "Quote" ADD COLUMN     "priceListId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_nombre_key" ON "PriceList"("nombre");

-- CreateIndex
CREATE INDEX "RentalPrice_priceListId_tipo_idx" ON "RentalPrice"("priceListId", "tipo");

-- CreateIndex
CREATE INDEX "AddOn_priceListId_idx" ON "AddOn"("priceListId");

-- CreateIndex
CREATE INDEX "FoodPackage_priceListId_idx" ON "FoodPackage"("priceListId");

-- CreateIndex
CREATE INDEX "Quote_priceListId_idx" ON "Quote"("priceListId");

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPackage" ADD CONSTRAINT "FoodPackage_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
