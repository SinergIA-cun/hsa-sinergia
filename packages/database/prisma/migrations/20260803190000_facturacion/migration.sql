-- Datos fiscales del cliente (CFDI 4.0). Todos opcionales: los clientes ya
-- capturados no los tienen y no deben romperse. El timbrado NO está en alcance;
-- el modelo se deja completo para que conectar un PAC después no exija migrar.
ALTER TABLE "Client" ADD COLUMN "rfc" TEXT;
ALTER TABLE "Client" ADD COLUMN "razonSocial" TEXT;
ALTER TABLE "Client" ADD COLUMN "regimenFiscal" TEXT;
ALTER TABLE "Client" ADD COLUMN "cpFiscal" TEXT;
ALTER TABLE "Client" ADD COLUMN "usoCfdi" TEXT;
ALTER TABLE "Client" ADD COLUMN "correoFacturacion" TEXT;
ALTER TABLE "Client" ADD COLUMN "csfKey" TEXT;
ALTER TABLE "Client" ADD COLUMN "csfMime" TEXT;

-- Marca por evento: este cliente pidió factura para ESTE evento.
ALTER TABLE "Quote" ADD COLUMN "requiereFactura" BOOLEAN NOT NULL DEFAULT false;
