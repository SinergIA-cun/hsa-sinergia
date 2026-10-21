-- Clientes (antes Banqueteros) con comisión de HSA (21-oct-2026).
ALTER TYPE "TipoProfesional" ADD VALUE 'otro';
ALTER TABLE "Banquetero" ADD COLUMN "comisionPct" DOUBLE PRECISION NOT NULL DEFAULT 10;
-- Sin cliente profesional ni agencia, la comisión vive en el evento (NULL = 10%).
ALTER TABLE "Quote" ADD COLUMN "comisionPct" DOUBLE PRECISION;
