-- Un precio de renta puede ser "no aplica" (NULL): ese día no se ofrece.
ALTER TABLE "RentalPrice"
  ALTER COLUMN "viernes" DROP NOT NULL,
  ALTER COLUMN "viernesEspecial" DROP NOT NULL,
  ALTER COLUMN "sabado" DROP NOT NULL,
  ALTER COLUMN "domAJue" DROP NOT NULL;

-- Hasta hoy la única forma de apagar un día era capturarlo en cero, y el motor lo
-- cobraba como renta de $0. Los ceros eran eso: "no se ofrece". Pasan a NULL.
UPDATE "RentalPrice" SET "viernes" = NULL WHERE "viernes" = 0;
UPDATE "RentalPrice" SET "viernesEspecial" = NULL WHERE "viernesEspecial" = 0;
UPDATE "RentalPrice" SET "sabado" = NULL WHERE "sabado" = 0;
UPDATE "RentalPrice" SET "domAJue" = NULL WHERE "domAJue" = 0;
