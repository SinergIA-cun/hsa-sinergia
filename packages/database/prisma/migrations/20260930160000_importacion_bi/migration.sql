-- Importación de eventos desde el BI (los que se celebran del 1-oct-2026 en
-- adelante y se vendieron antes del sistema).
--
-- Escrita a mano: el diff de Prisma trae el bloque de deriva de siempre
-- (`DROP SEQUENCE recibo_folio_seq / client_ref_seq`), que mata los folios.

ALTER TABLE "Quote" ADD COLUMN "importadoBI" TEXT;
ALTER TABLE "Quote" ADD COLUMN "contratadoEl" TIMESTAMP(3);
CREATE UNIQUE INDEX "Quote_importadoBI_key" ON "Quote"("importadoBI");

ALTER TABLE "Payment" ADD COLUMN "importadoBI" TEXT;
