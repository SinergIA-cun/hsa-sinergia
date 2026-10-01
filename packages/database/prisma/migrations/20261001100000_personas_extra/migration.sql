-- Personas extra antes de brincar de nivel, por catálogo. 0 = como antes, así
-- que ninguna cotización existente cambia de precio por esta migración.
ALTER TABLE "PriceList" ADD COLUMN "toleranciaExtras" INTEGER NOT NULL DEFAULT 0;

-- Los alimentos de los invitados extra en el punto de venta, aparte de su renta.
ALTER TYPE "ProductoCargo" ADD VALUE IF NOT EXISTS 'invitadoExtraAlimentos';
