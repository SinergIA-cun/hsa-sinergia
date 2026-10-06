-- El descuento puede ser en monto fijo, no solo en porcentaje (decisión del
-- dueño, 5-oct-2026). Es uno u otro.
ALTER TABLE "Quote" ADD COLUMN "descuentoMonto" INTEGER;
ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_descuentoMonto_positivo" CHECK ("descuentoMonto" IS NULL OR "descuentoMonto" > 0),
  ADD CONSTRAINT "Quote_un_solo_descuento" CHECK ("descuentoPct" IS NULL OR "descuentoMonto" IS NULL);
