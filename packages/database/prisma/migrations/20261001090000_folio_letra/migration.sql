-- La letra de cada aplicación de un depósito repartido: I 5340-A, -B, -C.
-- Las aplicaciones que ya existen se quedan sin letra (no se renumera nada).
ALTER TABLE "Payment" ADD COLUMN "folioLetra" TEXT;
ALTER TABLE "AbonoApartado" ADD COLUMN "folioLetra" TEXT;
