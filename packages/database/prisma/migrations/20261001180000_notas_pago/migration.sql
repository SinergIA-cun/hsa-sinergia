-- Notas libres en cada entrada de dinero: pagos, depósitos de banquetero y abonos.
ALTER TABLE "Payment" ADD COLUMN "notas" TEXT;
ALTER TABLE "PagoBanquetero" ADD COLUMN "notas" TEXT;
ALTER TABLE "AbonoApartado" ADD COLUMN "notas" TEXT;
