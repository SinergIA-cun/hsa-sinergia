-- Hora extra en % de la renta o en monto fijo por hora, por evento (Fernando,
-- 16-oct-2026). Sin ninguno de los dos, el % del catálogo (extraHourRate).
ALTER TABLE "Quote" ADD COLUMN "horaExtraPct" DOUBLE PRECISION;
ALTER TABLE "Quote" ADD COLUMN "horaExtraMonto" DOUBLE PRECISION;
