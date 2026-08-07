-- Dos tipos nuevos de bitácora para el candado fiscal por factura:
--   factura = un admin selló un pago como facturado (hoy es el único disparador
--             del candado; cuando se conecte el PAC lo escribirá el timbrado)
--   fiscal  = se cambiaron los datos fiscales del cliente, incluido el caso en
--             que un admin los movió estando ya congelados
--
-- `ADD VALUE` es idempotente con IF NOT EXISTS y no reescribe la tabla.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'factura';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'fiscal';
