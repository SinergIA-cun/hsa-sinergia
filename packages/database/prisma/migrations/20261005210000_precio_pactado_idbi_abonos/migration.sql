-- Precio pactado como columna propia (antes se deducía de `importadoBI`): ahora
-- también lo tienen los apartados convertidos con renta acordada.
ALTER TABLE "Quote" ADD COLUMN "precioPactado" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Quote" SET "precioPactado" = true WHERE "importadoBI" IS NOT NULL;

-- El idBI de cada pago de un apartado importado: la llave del BI para no contar
-- doble cuando lea del Cotizador. Pasa al pago del evento al convertir.
ALTER TABLE "AbonoApartado" ADD COLUMN "importadoBI" TEXT;

-- La capilla de una fecha apartada (marca; prellena la conversión).
ALTER TABLE "ApartadoFecha" ADD COLUMN "usaCapilla" BOOLEAN NOT NULL DEFAULT false;
