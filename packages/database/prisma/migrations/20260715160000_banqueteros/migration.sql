-- Banqueteros (proveedores de alimentos) + vínculo con el contrato para ventas por banquetero.
CREATE TABLE "Banquetero" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "telefono" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Banquetero_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quote" ADD COLUMN "banqueteroId" TEXT;
CREATE INDEX "Quote_banqueteroId_idx" ON "Quote"("banqueteroId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_banqueteroId_fkey" FOREIGN KEY ("banqueteroId") REFERENCES "Banquetero"("id") ON DELETE SET NULL ON UPDATE CASCADE;
