-- Descuento / promoción: el mismo descuento de la cortesía, sin color en la agenda.
ALTER TABLE "Quote" ADD COLUMN "esPromocion" BOOLEAN NOT NULL DEFAULT false;
