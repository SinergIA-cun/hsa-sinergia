-- Proveedor y comisión de los servicios de un evento (11-nov-2026). Todo NULL =
-- sin comisión, así que los servicios que ya existen no cambian.
ALTER TABLE "QuoteExtra" ADD COLUMN "proveedor" TEXT;
ALTER TABLE "QuoteExtra" ADD COLUMN "comisionPct" DOUBLE PRECISION;
ALTER TABLE "QuoteExtra" ADD COLUMN "comisionMonto" DOUBLE PRECISION;

-- Lo mismo en los cargos del punto de venta (el grupo musical de un evento).
ALTER TABLE "CargoEvento" ADD COLUMN "proveedor" TEXT;
ALTER TABLE "CargoEvento" ADD COLUMN "comisionPct" DOUBLE PRECISION;
ALTER TABLE "CargoEvento" ADD COLUMN "comisionMonto" DOUBLE PRECISION;
