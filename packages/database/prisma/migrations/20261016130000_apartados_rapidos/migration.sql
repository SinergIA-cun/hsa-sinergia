-- Apartados rápidos con fila de espera (Jorge, 15-oct-2026) y ajustes del admin.
-- OJO: el diff de Prisma trae el bloque de deriva DROP SEQUENCE recibo_folio_seq / client_ref_seq: se quitó a mano.


-- CreateEnum
CREATE TYPE "EstadoApartadoRapido" AS ENUM ('activo', 'liberado', 'convertido');

-- CreateTable
CREATE TABLE "ApartadoRapido" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "vence" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoApartadoRapido" NOT NULL DEFAULT 'activo',
    "nota" TEXT,
    "extensiones" INTEGER NOT NULL DEFAULT 0,
    "avisoEnviadoAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoAt" TIMESTAMP(3),
    "cerradoById" TEXT,
    "motivoCierre" TEXT,
    "quoteId" TEXT,

    CONSTRAINT "ApartadoRapido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ajuste" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ajuste_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApartadoRapido_quoteId_key" ON "ApartadoRapido"("quoteId");

-- CreateIndex
CREATE INDEX "ApartadoRapido_fecha_estado_idx" ON "ApartadoRapido"("fecha", "estado");

-- CreateIndex
CREATE INDEX "ApartadoRapido_estado_vence_idx" ON "ApartadoRapido"("estado", "vence");

-- AddForeignKey
ALTER TABLE "ApartadoRapido" ADD CONSTRAINT "ApartadoRapido_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoRapido" ADD CONSTRAINT "ApartadoRapido_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoRapido" ADD CONSTRAINT "ApartadoRapido_cerradoById_fkey" FOREIGN KEY ("cerradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoRapido" ADD CONSTRAINT "ApartadoRapido_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
