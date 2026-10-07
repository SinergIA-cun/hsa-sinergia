-- Correos al cliente: bienvenida al formalizar, recibo por pago y cierre.
CREATE TYPE "TipoCorreo" AS ENUM ('bienvenida', 'recibo', 'cierre');
CREATE TYPE "EstadoCorreo" AS ENUM ('pendiente', 'enviado', 'error', 'omitido');

CREATE TABLE "CorreoCliente" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tipo" "TipoCorreo" NOT NULL,
    "paymentId" TEXT,
    "clave" TEXT NOT NULL,
    "para" TEXT,
    "estado" "EstadoCorreo" NOT NULL DEFAULT 'pendiente',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "enviadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CorreoCliente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorreoCliente_clave_key" ON "CorreoCliente"("clave");
CREATE INDEX "CorreoCliente_estado_idx" ON "CorreoCliente"("estado");
CREATE INDEX "CorreoCliente_quoteId_idx" ON "CorreoCliente"("quoteId");
ALTER TABLE "CorreoCliente" ADD CONSTRAINT "CorreoCliente_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
