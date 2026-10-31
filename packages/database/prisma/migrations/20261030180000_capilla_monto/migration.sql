-- Monto de capilla por evento (30-oct-2026). NULL = la regla de siempre, así que
-- los eventos que ya existen no cambian.
ALTER TABLE "Quote" ADD COLUMN "capillaMonto" DOUBLE PRECISION;
