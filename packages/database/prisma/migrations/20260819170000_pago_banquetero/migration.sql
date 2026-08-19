-- Cuenta corriente del banquetero (Plan H, Task 1).
--
-- El depósito entra a la cuenta del banquetero y DESPUÉS se reparte entre sus
-- eventos. Cada asignación genera un `Payment` real en la cotización, con su
-- folio de recibo, y lo único que gana el pago es `pagoBanqueteroId`: la liga al
-- depósito madre. Así el estado de cuenta, los hitos del plan, el candado de
-- facturación y el API del BI siguen funcionando sin cambiar una línea.
--
-- NOTA: `prisma migrate diff` reintroduce en CADA corrida un bloque
-- `DROP SEQUENCE "client_ref_seq"` / `DROP SEQUENCE "recibo_folio_seq"` (no
-- entiende los `dbgenerated(nextval(...))`). Se borraron a mano: romper
-- `recibo_folio_seq` mata el folio de los recibos, que es justamente lo que esta
-- migración necesita que siga vivo.

-- CreateTable
CREATE TABLE "PagoBanquetero" (
    "id" TEXT NOT NULL,
    "banqueteroId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "referencia" TEXT,
    "comprobanteKey" TEXT,
    "comprobanteMime" TEXT,
    "registradoById" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" TEXT,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoBanquetero_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "pagoBanqueteroId" TEXT;

-- CreateIndex
CREATE INDEX "PagoBanquetero_banqueteroId_fecha_idx" ON "PagoBanquetero"("banqueteroId", "fecha");

-- CreateIndex
CREATE INDEX "Payment_pagoBanqueteroId_idx" ON "Payment"("pagoBanqueteroId");

-- AddForeignKey
ALTER TABLE "PagoBanquetero" ADD CONSTRAINT "PagoBanquetero_banqueteroId_fkey" FOREIGN KEY ("banqueteroId") REFERENCES "Banquetero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoBanquetero" ADD CONSTRAINT "PagoBanquetero_registradoById_fkey" FOREIGN KEY ("registradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoBanquetero" ADD CONSTRAINT "PagoBanquetero_anuladoById_fkey" FOREIGN KEY ("anuladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pagoBanqueteroId_fkey" FOREIGN KEY ("pagoBanqueteroId") REFERENCES "PagoBanquetero"("id") ON DELETE SET NULL ON UPDATE CASCADE;
