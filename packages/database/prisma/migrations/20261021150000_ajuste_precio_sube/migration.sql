-- "Ajuste en precio / promoción" (21-oct-2026): el ajuste también SUBE la renta.
-- Se guarda con signo: positivo baja (como siempre), negativo sube.
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_descuentoMonto_positivo";
ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_descuentoMonto_no_cero" CHECK ("descuentoMonto" IS NULL OR "descuentoMonto" <> 0);
