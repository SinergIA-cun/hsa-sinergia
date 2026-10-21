-- "Aplicar promoción" por contratar alimentos (21-oct-2026): % de 0 a 5.
-- NULL = evento de antes: sigue con el % del catálogo.
ALTER TABLE "Quote" ADD COLUMN "descuentoAlimentosPct" DOUBLE PRECISION;
