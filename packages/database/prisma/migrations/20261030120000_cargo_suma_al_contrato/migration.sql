-- Los cargos del punto de venta guardan si suben el valor del evento (30-oct-2026).
-- Desde hoy todo sube salvo multas y daños; los de antes se quedan como estaban:
-- solo horas extra de salón y PAX extra subían el contrato.
ALTER TABLE "CargoEvento" ADD COLUMN "sumaAlContrato" BOOLEAN NOT NULL DEFAULT false;
UPDATE "CargoEvento" SET "sumaAlContrato" = true WHERE "producto" IN ('horaExtra', 'invitadoExtra');
