-- La agencia que paga la comisión del paquete, aparte del banquetero-cliente (BI #4).
ALTER TABLE "Quote" ADD COLUMN "agenciaId" TEXT;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Banquetero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Quote_agenciaId_idx" ON "Quote"("agenciaId");
