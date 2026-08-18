-- Bitácora de cambios AL CONTENIDO de un catálogo (Plan E · tramo 2).
--
-- Va en su propia tabla y no en `ActivityLog` porque esa exige `quoteId` NOT
-- NULL: un cambio de precio no pertenece a UNA cotización, pertenece a todas
-- las que cuelgan del catálogo.
--
-- `cotizacionesEnRiesgo` se escribe con el número del MOMENTO del cambio y no
-- se recalcula al leer: la medida que importa es cuántas cotizaciones puso en
-- riesgo quien editó, entonces.
--
-- NOTA: se quitó a mano el bloque que Prisma vuelve a meter en cada diff —
-- `DROP SEQUENCE client_ref_seq` y `DROP SEQUENCE recibo_folio_seq`. Es deriva
-- histórica del esquema (los defaults son `dbgenerated`), no un cambio de este
-- plan, y ejecutarlo rompería el folio de recibos y el número de cliente.

-- CreateTable
CREATE TABLE "PriceListAudit" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "meta" JSONB,
    "actorId" TEXT,
    "cotizacionesEnRiesgo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceListAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceListAudit_priceListId_createdAt_idx" ON "PriceListAudit"("priceListId", "createdAt");

-- AddForeignKey
-- RESTRICT en el catálogo: borrar un catálogo que tiene bitácora exige borrar la
-- bitácora primero, a propósito. La misma regla que ya rige a renta y servicios.
ALTER TABLE "PriceListAudit" ADD CONSTRAINT "PriceListAudit_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL en el actor: borrar a la persona no debe borrar el rastro del cambio.
ALTER TABLE "PriceListAudit" ADD CONSTRAINT "PriceListAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
