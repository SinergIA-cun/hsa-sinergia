-- Panel de facturación y facturas del PAC (26-nov-2026).
--
-- `accesoFacturacion`: permiso aparte del rol para entrar al panel.
-- `FacturaPac`: las facturas tal como las tiene Facturador.com, sincronizadas
-- tres veces al día (8:00, 13:00 y 19:00 de Cancún) y al timbrar desde la app.
-- `SincronizacionPac`: cada vuelta de esa sincronización.

ALTER TABLE "User" ADD COLUMN "accesoFacturacion" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FacturaPac" (
    "uuid" TEXT NOT NULL,
    "idComprobante" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL,
    "serie" TEXT,
    "folio" TEXT,
    "tipoComprobante" TEXT,
    "estatus" TEXT,
    "subestatus" TEXT,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DOUBLE PRECISION,
    "impuestos" DOUBLE PRECISION,
    "total" DOUBLE PRECISION NOT NULL,
    "moneda" TEXT,
    "receptorRfc" TEXT,
    "receptorNombre" TEXT,
    "formaPagoClave" TEXT,
    "formaPagoNombre" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'pac',
    "crudo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacturaPac_pkey" PRIMARY KEY ("uuid")
);

CREATE TABLE "SincronizacionPac" (
    "id" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3) NOT NULL,
    "nuevas" INTEGER NOT NULL DEFAULT 0,
    "actualizadas" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SincronizacionPac_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FacturaPac_fecha_idx" ON "FacturaPac"("fecha");
CREATE INDEX "SincronizacionPac_inicio_idx" ON "SincronizacionPac"("inicio");

-- La bitácora forense también las cubre.
SELECT asegurar_auditoria();
