-- Servicio suelto de UN evento (punto 2 del Plan G). Tabla nueva y nada más:
-- ninguna cotización existente tiene extras, así que no hay backfill que hacer.
--
-- Lo que NO va aquí, aunque `prisma migrate diff` lo vuelva a meter en CADA diff:
--   ALTER TABLE "Client" ... DROP DEFAULT; DROP SEQUENCE "client_ref_seq";
--   ALTER TABLE "Payment" ... DROP DEFAULT; DROP SEQUENCE "recibo_folio_seq";
-- Es deriva histórica de los `dbgenerated("nextval(...)")` de
-- 20260710163602_ref_folio_comprobante, no un cambio de esta task. Ejecutarlo
-- rompería el folio de los recibos y el número de referencia del cliente.

-- CreateTable
CREATE TABLE "QuoteExtra" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "kind" "AddOnKind" NOT NULL,
    "monto" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QuoteExtra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteExtra_quoteId_idx" ON "QuoteExtra"("quoteId");

-- AddForeignKey
-- ON DELETE CASCADE a propósito: el renglón es de la cotización y no significa
-- nada sin ella. Con RESTRICT, borrar una cotización con extras truena.
ALTER TABLE "QuoteExtra" ADD CONSTRAINT "QuoteExtra_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
