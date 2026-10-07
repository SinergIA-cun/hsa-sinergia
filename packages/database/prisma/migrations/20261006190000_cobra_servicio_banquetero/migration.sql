-- Quién cobra cada servicio del catálogo y lo que pone el banquetero en un evento.
CREATE TYPE "CobraServicio" AS ENUM ('proveedor', 'hacienda');
ALTER TABLE "AddOn" ADD COLUMN "cobra" "CobraServicio" NOT NULL DEFAULT 'proveedor';

CREATE TABLE "ServicioBanquetero" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "monto" INTEGER,
    CONSTRAINT "ServicioBanquetero_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServicioBanquetero_quoteId_idx" ON "ServicioBanquetero"("quoteId");
ALTER TABLE "ServicioBanquetero" ADD CONSTRAINT "ServicioBanquetero_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
