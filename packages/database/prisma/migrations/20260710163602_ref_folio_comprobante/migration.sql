CREATE SEQUENCE IF NOT EXISTS client_ref_seq START 1000;
ALTER TABLE "Client" ADD COLUMN "numeroReferencia" INTEGER NOT NULL DEFAULT nextval('client_ref_seq');
ALTER TABLE "Client" ADD CONSTRAINT "Client_numeroReferencia_key" UNIQUE ("numeroReferencia");

CREATE SEQUENCE IF NOT EXISTS recibo_folio_seq START 1;
ALTER TABLE "Payment" ADD COLUMN "folio" INTEGER NOT NULL DEFAULT nextval('recibo_folio_seq');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_folio_key" UNIQUE ("folio");
ALTER TABLE "Payment" ADD COLUMN "comprobanteKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "comprobanteMime" TEXT;
