-- Candado de facturación, POR PAGO: el SAT exige facturar el ingreso en el mes
-- en que se recibe, así que un anticipo de marzo se factura en marzo aunque el
-- evento sea en octubre.
--   facturadoAt   = cuándo se timbró el CFDI (lo llenará el PAC más adelante)
--   facturaUuid   = folio fiscal del CFDI (columna lista para esa integración)
--   desbloqueoAt  = un admin reabrió este pago para corregir tras una cancelación
ALTER TABLE "Payment" ADD COLUMN "facturadoAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "facturaUuid" TEXT;
ALTER TABLE "Payment" ADD COLUMN "desbloqueoAt" TIMESTAMP(3);
