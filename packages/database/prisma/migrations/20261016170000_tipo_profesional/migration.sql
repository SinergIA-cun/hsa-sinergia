-- Tipo de profesional de eventos (reunión del 15-oct-2026): B, BG, A, WP.
CREATE TYPE "TipoProfesional" AS ENUM ('banquetero', 'banqueteGraduacion', 'agencia', 'weddingPlanner');
ALTER TABLE "Banquetero" ADD COLUMN "tipo" "TipoProfesional" NOT NULL DEFAULT 'banquetero';
