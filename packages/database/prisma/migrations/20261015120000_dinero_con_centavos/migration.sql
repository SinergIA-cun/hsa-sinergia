-- Dinero con centavos (Jorge, 15-oct-2026): el dinero que se MUEVE pasa de pesos
-- enteros a double precision. El catálogo (rentas, paquetes, servicios, DJ, reglas
-- de pago) se queda en pesos enteros. Los valores actuales se conservan tal cual
-- (un entero cabe exacto en double precision). La app redondea a centavos al
-- escribir y suma en centavos enteros (@hsa/shared dinero.ts).
ALTER TABLE "PagoBanquetero"     ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
ALTER TABLE "ApartadoFecha"      ALTER COLUMN "precioAcordado"      TYPE DOUBLE PRECISION;
ALTER TABLE "AbonoApartado"      ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
ALTER TABLE "Quote"              ALTER COLUMN "total"               TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "rentaTotal"          TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "descuentoMonto"      TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "cancelacionPagado"   TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "cancelacionDevolver" TYPE DOUBLE PRECISION;
ALTER TABLE "QuoteExtra"         ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
ALTER TABLE "ServicioBanquetero" ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
ALTER TABLE "Payment"            ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
ALTER TABLE "EventoHistorico"    ALTER COLUMN "total"               TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "pagado"              TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "saldo"               TYPE DOUBLE PRECISION;
ALTER TABLE "CargoEvento"        ALTER COLUMN "precioUnitario"      TYPE DOUBLE PRECISION,
                                 ALTER COLUMN "total"               TYPE DOUBLE PRECISION;
ALTER TABLE "Devolucion"         ALTER COLUMN "monto"               TYPE DOUBLE PRECISION;
