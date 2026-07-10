/*
  Warnings:

  - You are about to drop the `PaymentRule` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('creada', 'estatus', 'pago', 'pagoAnulado', 'edicion');

-- AlterEnum
ALTER TYPE "PaymentConcept" ADD VALUE 'complemento';

-- DropForeignKey
ALTER TABLE "PaymentRule" DROP CONSTRAINT "PaymentRule_eventTypeId_fkey";

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "horaInicio" TEXT,
ADD COLUMN     "horaTermino" TEXT,
ADD COLUMN     "horarioCivil" TEXT;

-- DropTable
DROP TABLE "PaymentRule";

-- CreateTable
CREATE TABLE "SpacePaymentRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "anticipo" INTEGER NOT NULL,
    "complementoPct" DOUBLE PRECISION NOT NULL,
    "liquidarDiasAntes" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "SpacePaymentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "concepto" "PaymentConcept" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "referencia" TEXT,
    "comprobanteUrl" TEXT,
    "comprobantePendiente" BOOLEAN NOT NULL DEFAULT false,
    "registradoById" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" TEXT,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tipo" "ActivityType" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "meta" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpacePaymentRule_spaceId_key" ON "SpacePaymentRule"("spaceId");

-- CreateIndex
CREATE INDEX "Payment_quoteId_idx" ON "Payment"("quoteId");

-- CreateIndex
CREATE INDEX "ActivityLog_quoteId_idx" ON "ActivityLog"("quoteId");

-- AddForeignKey
ALTER TABLE "SpacePaymentRule" ADD CONSTRAINT "SpacePaymentRule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registradoById_fkey" FOREIGN KEY ("registradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_anuladoById_fkey" FOREIGN KEY ("anuladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
