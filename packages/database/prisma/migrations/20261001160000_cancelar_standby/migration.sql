-- Un evento se puede cancelar, poner en standby (sin fecha) y reprogramar.

ALTER TYPE "QuoteStatus" ADD VALUE 'standby';
ALTER TYPE "QuoteStatus" ADD VALUE 'cancelada';

ALTER TYPE "ActivityType" ADD VALUE 'cancelada';
ALTER TYPE "ActivityType" ADD VALUE 'standby';
ALTER TYPE "ActivityType" ADD VALUE 'reprogramada';

ALTER TABLE "Quote"
  ADD COLUMN "statusPrevio" "QuoteStatus",
  ADD COLUMN "standbyDesde" TIMESTAMP(3),
  ADD COLUMN "standbyMotivo" TEXT,
  ADD COLUMN "canceladaAt" TIMESTAMP(3),
  ADD COLUMN "cancelacionMotivo" TEXT,
  ADD COLUMN "cancelacionPct" DOUBLE PRECISION,
  ADD COLUMN "cancelacionPagado" INTEGER,
  ADD COLUMN "cancelacionDevolver" INTEGER;

-- Un porcentaje fuera de 0..100 no es una decisión, es un error de captura.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_cancelacionPct_rango"
  CHECK ("cancelacionPct" IS NULL OR ("cancelacionPct" >= 0 AND "cancelacionPct" <= 100));
