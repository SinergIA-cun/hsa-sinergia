-- Capilla como cortesía por-evento (toggle), no como espacio cotizable.
ALTER TABLE "Quote" ADD COLUMN "usaCapilla" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PricingConfig" ADD COLUMN "capillaSabado" INTEGER NOT NULL DEFAULT 5000;
