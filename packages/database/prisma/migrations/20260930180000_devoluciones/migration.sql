-- Devoluciones: dinero que la hacienda regresa a un cliente (de la renta o de
-- la cuenta del punto de venta) o a un banquetero (de su saldo a favor).
--
-- Se quitó a mano el bloque de deriva `DROP SEQUENCE recibo_folio_seq /
-- client_ref_seq` que Prisma reintroduce siempre.

ALTER TYPE "ActivityType" ADD VALUE 'devolucion';
ALTER TYPE "ActivityType" ADD VALUE 'devolucionAnulada';

-- CreateTable
CREATE TABLE "Devolucion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT,
    "destino" "PaymentDestino",
    "banqueteroId" TEXT,
    "pagoBanqueteroId" TEXT,
    "monto" INTEGER NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "formas" JSONB,
    "fecha" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "referencia" TEXT,
    "notaCreditoUuid" TEXT,
    "registradoById" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" TEXT,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Devolucion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Devolucion_quoteId_idx" ON "Devolucion"("quoteId");

-- CreateIndex
CREATE INDEX "Devolucion_banqueteroId_idx" ON "Devolucion"("banqueteroId");

-- CreateIndex
CREATE INDEX "Devolucion_pagoBanqueteroId_idx" ON "Devolucion"("pagoBanqueteroId");

-- CreateIndex
CREATE INDEX "Devolucion_fecha_idx" ON "Devolucion"("fecha");

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_banqueteroId_fkey" FOREIGN KEY ("banqueteroId") REFERENCES "Banquetero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_pagoBanqueteroId_fkey" FOREIGN KEY ("pagoBanqueteroId") REFERENCES "PagoBanquetero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_registradoById_fkey" FOREIGN KEY ("registradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_anuladoById_fkey" FOREIGN KEY ("anuladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una devolución es de un evento o de un banquetero, nunca de los dos ni de
-- ninguno. La regla va en la base: una fila huérfana no le restaría a nadie y
-- el dinero desaparecería de los números.
ALTER TABLE "Devolucion" ADD CONSTRAINT "Devolucion_un_solo_lado"
  CHECK (("quoteId" IS NOT NULL) <> ("banqueteroId" IS NOT NULL));

-- La tabla nueva entra a la bitácora forense como todas las demás.
SELECT asegurar_auditoria();
