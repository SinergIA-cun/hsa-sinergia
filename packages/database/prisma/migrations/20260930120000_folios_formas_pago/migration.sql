-- Folios de la serie I (uno por cada dinero que entra) y formas de pago divididas.
--
-- Escrita a mano, no con `migrate dev`, por dos razones:
--
-- 1. `folio` en PagoBanquetero y AbonoApartado se agrega SIN default y el default
--    se pone DESPUÉS. `ADD COLUMN ... DEFAULT nextval(...)` le daría un número a
--    cada fila existente, y el dueño pidió no renumerar nada: los depósitos y
--    abonos viejos se quedan "sin folio" y solo lo nuevo gasta la secuencia.
-- 2. Prisma reintroduce en el diff el `DROP SEQUENCE "recibo_folio_seq"` de
--    siempre, y borrarla mata el folio de los recibos.

-- Formas nuevas. `ADD VALUE` no puede usarse dentro de la misma transacción en
-- que se agrega, y aquí no se usa: solo se declara.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'cheque';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'tarjetaDebito';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'tarjetaCredito';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'mixto';

-- El folio de Payment deja de ser único: los pagos que salen de un mismo
-- depósito comparten el folio del depósito. La secuencia sigue siendo la que
-- garantiza que dos entradas de dinero no choquen.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_folio_key";
CREATE INDEX "Payment_folio_idx" ON "Payment"("folio");
ALTER TABLE "Payment" ADD COLUMN "formas" JSONB;

ALTER TABLE "PagoBanquetero" ADD COLUMN "folio" INTEGER;
ALTER TABLE "PagoBanquetero" ALTER COLUMN "folio" SET DEFAULT nextval('recibo_folio_seq');
ALTER TABLE "PagoBanquetero" ADD COLUMN "formas" JSONB;

ALTER TABLE "AbonoApartado" ADD COLUMN "folio" INTEGER;
ALTER TABLE "AbonoApartado" ALTER COLUMN "folio" SET DEFAULT nextval('recibo_folio_seq');
ALTER TABLE "AbonoApartado" ADD COLUMN "formas" JSONB;

CREATE TABLE "CambioFolio" (
    "id" TEXT NOT NULL,
    "siguiente" INTEGER NOT NULL,
    "anterior" INTEGER NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CambioFolio_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CambioFolio" ADD CONSTRAINT "CambioFolio_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La tabla nueva entra a la bitácora forense como todas las demás.
SELECT asegurar_auditoria();
