-- Punto de venta: la cuenta de cargos del evento (horas extra, multas,
-- invitados extra, gastos imprevistos) y el destino de cada pago.
--
-- Todos los pagos existentes quedan con destino `evento`: son la renta
-- contratada, que es lo único que existía.
--
-- Se quitó a mano el bloque de deriva `DROP SEQUENCE recibo_folio_seq /
-- client_ref_seq` que Prisma reintroduce siempre: borrarlo mata los folios.

-- CreateEnum
CREATE TYPE "PaymentDestino" AS ENUM ('evento', 'cargos');

-- CreateEnum
CREATE TYPE "ProductoCargo" AS ENUM ('horaExtra', 'djHoraExtra', 'invitadoExtra', 'danos', 'multa', 'gastoImprevisto', 'otro');


ALTER TYPE "ActivityType" ADD VALUE 'cargo';
ALTER TYPE "ActivityType" ADD VALUE 'cargoAnulado';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "destino" "PaymentDestino" NOT NULL DEFAULT 'evento';

-- CreateTable
CREATE TABLE "CargoEvento" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "producto" "ProductoCargo" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "registradoById" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" TEXT,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CargoEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CargoEvento_quoteId_idx" ON "CargoEvento"("quoteId");

-- CreateIndex
CREATE INDEX "CargoEvento_fecha_idx" ON "CargoEvento"("fecha");

-- AddForeignKey
ALTER TABLE "CargoEvento" ADD CONSTRAINT "CargoEvento_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CargoEvento" ADD CONSTRAINT "CargoEvento_registradoById_fkey" FOREIGN KEY ("registradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CargoEvento" ADD CONSTRAINT "CargoEvento_anuladoById_fkey" FOREIGN KEY ("anuladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La tabla nueva entra a la bitácora forense como todas las demás.
SELECT asegurar_auditoria();
