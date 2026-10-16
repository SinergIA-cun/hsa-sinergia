-- Columnas de la tabla de renta configurables por catálogo (16-oct-2026).

-- CreateTable
CREATE TABLE "ColumnaRenta" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dias" INTEGER[],
    "meses" INTEGER[],
    "respaldo" TEXT,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "ColumnaRenta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ColumnaRenta_priceListId_clave_key" ON "ColumnaRenta"("priceListId", "clave");

ALTER TABLE "ColumnaRenta" ADD CONSTRAINT "ColumnaRenta_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las cuatro columnas de siempre, con la regla que tenía el código, en cada catálogo.
INSERT INTO "ColumnaRenta" ("id", "priceListId", "clave", "nombre", "dias", "meses", "respaldo", "orden")
SELECT 'colr_' || md5(pl."id" || c.clave), pl."id", c.clave, c.nombre, c.dias, c.meses, c.respaldo, c.orden
FROM "PriceList" pl
CROSS JOIN (VALUES
  ('viernes', 'Viernes', ARRAY[5], ARRAY[]::INTEGER[], NULL, 0),
  ('viernesEspecial', 'Viernes especial', ARRAY[5], ARRAY[3,4,5,9,10], 'viernes', 1),
  ('sabado', 'Sábado', ARRAY[6], ARRAY[]::INTEGER[], NULL, 2),
  ('domAJue', 'Dom a jue', ARRAY[0,1,2,3,4], ARRAY[]::INTEGER[], NULL, 3)
) AS c(clave, nombre, dias, meses, respaldo, orden);

-- Los precios pasan a un mapa por clave de columna.
ALTER TABLE "RentalPrice" ADD COLUMN "precios" JSONB NOT NULL DEFAULT '{}';
UPDATE "RentalPrice" SET "precios" = jsonb_build_object(
  'viernes', "viernes",
  'viernesEspecial', "viernesEspecial",
  'sabado', "sabado",
  'domAJue', "domAJue"
);

ALTER TABLE "RentalPrice" DROP COLUMN "viernes",
DROP COLUMN "viernesEspecial",
DROP COLUMN "sabado",
DROP COLUMN "domAJue";
