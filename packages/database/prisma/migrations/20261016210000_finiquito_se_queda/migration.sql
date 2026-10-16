-- "Que el finiquito se quede" (Fernando, 16-oct-2026): el pago que completó el
-- contrato guarda el total que completó. Si después el contrato sube (horas
-- extra, PAX extra), sigue siendo el finiquito y lo que llega es a cuenta.
ALTER TABLE "Payment" ADD COLUMN "finiquitoDe" DOUBLE PRECISION;

-- Los finiquitos vivos de hoy completaron la renta que hoy tiene su evento.
UPDATE "Payment" p
SET "finiquitoDe" = q."rentaTotal"
FROM "Quote" q
WHERE q."id" = p."quoteId" AND p."concepto" = 'finiquito' AND p."anuladoAt" IS NULL;
