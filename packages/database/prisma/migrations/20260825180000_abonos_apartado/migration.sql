-- Una fecha apartada se vuelve una cuenta: muchos abonos en vez de un depósito.
--
-- Un banquetero pide 2029 y abona de a poco durante dos años. Con UNA columna
-- `deposito` eso no cabía: o se pisaba el monto anterior —y con él la fecha en
-- que entró cada peso, que es lo que el SAT mira— o no se registraba.

CREATE TABLE "AbonoApartado" (
    "id" TEXT NOT NULL,
    "apartadoId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "metodo" "PaymentMethod" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "referencia" TEXT,
    "comprobanteKey" TEXT,
    "comprobanteMime" TEXT,
    "pagoBanqueteroId" TEXT,
    "paymentId" TEXT,
    "registradoById" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" TEXT,
    "motivoAnulacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbonoApartado_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AbonoApartado_paymentId_key" ON "AbonoApartado"("paymentId");
CREATE INDEX "AbonoApartado_apartadoId_idx" ON "AbonoApartado"("apartadoId");
CREATE INDEX "AbonoApartado_pagoBanqueteroId_idx" ON "AbonoApartado"("pagoBanqueteroId");

ALTER TABLE "AbonoApartado" ADD CONSTRAINT "AbonoApartado_apartadoId_fkey"
  FOREIGN KEY ("apartadoId") REFERENCES "ApartadoFecha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbonoApartado" ADD CONSTRAINT "AbonoApartado_pagoBanqueteroId_fkey"
  FOREIGN KEY ("pagoBanqueteroId") REFERENCES "PagoBanquetero"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AbonoApartado" ADD CONSTRAINT "AbonoApartado_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AbonoApartado" ADD CONSTRAINT "AbonoApartado_registradoById_fkey"
  FOREIGN KEY ("registradoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AbonoApartado" ADD CONSTRAINT "AbonoApartado_anuladoById_fkey"
  FOREIGN KEY ("anuladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- Antes de tirar las columnas: que no se pierda un peso.
--
-- Un depósito sin forma de pago o sin fecha de recepción no se puede convertir en
-- abono sin inventarle los datos que le faltan, y un dato de dinero inventado se
-- ve igual que uno real. Si existe una fila así, esta migración PARA — es
-- preferible un arranque detenido con una instrucción clara que un monto perdido
-- en silencio.
--
-- `convertirApartado` ya rechazaba esas filas desde que existe, así que si
-- aparece una, ya estaba rota antes de este cambio.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  incompletos integer;
BEGIN
  SELECT count(*) INTO incompletos FROM "ApartadoFecha"
   WHERE "deposito" > 0 AND ("depositoMetodo" IS NULL OR "depositoFecha" IS NULL);
  IF incompletos > 0 THEN
    RAISE EXCEPTION
      'Hay % apartado(s) con depósito pero sin forma de pago o sin fecha de recepción. Complétalos antes de migrar: UPDATE "ApartadoFecha" SET "depositoMetodo" = ''transferencia'', "depositoFecha" = "createdAt" WHERE "deposito" > 0 AND ("depositoMetodo" IS NULL OR "depositoFecha" IS NULL);',
      incompletos;
  END IF;
END $$;

-- El depósito de cada apartado se vuelve su primer abono. `gen_random_uuid()` es
-- VOLATILE, así que cada fila recibe el suyo (ya se verificó en este repo).
INSERT INTO "AbonoApartado" ("id", "apartadoId", "monto", "metodo", "fecha", "referencia", "registradoById", "createdAt")
SELECT
  replace((gen_random_uuid())::text, '-', ''),
  a."id",
  a."deposito",
  a."depositoMetodo",
  a."depositoFecha",
  'Depósito al apartar',
  a."createdById",
  a."createdAt"
FROM "ApartadoFecha" a
WHERE a."deposito" > 0;

ALTER TABLE "ApartadoFecha" DROP COLUMN "deposito",
  DROP COLUMN "depositoFecha",
  DROP COLUMN "depositoMetodo";
