-- Descuento de cortesía (punto 7 del Plan G). `esCortesia` se guardaba desde
-- 20260714160000_cortesia_familiar y el motor NUNCA la leyó: esta migración trae
-- las dos columnas que por fin le dan efecto al precio.
--
-- Ambas nullable y sin default: las cotizaciones existentes quedan en NULL, que
-- es exactamente "sin descuento" — el comportamiento de hoy. No hay backfill.
--
-- Lo que NO va aquí, aunque `prisma migrate diff` lo reintroduzca en CADA diff:
--   DROP SEQUENCE "client_ref_seq" / DROP SEQUENCE "recibo_folio_seq".
-- Es deriva histórica de 20260710163602_ref_folio_comprobante. Ejecutarlo
-- rompería el folio de los recibos y el número de referencia del cliente.

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "descuentoMotivo" TEXT,
ADD COLUMN     "descuentoPct" DOUBLE PRECISION;
