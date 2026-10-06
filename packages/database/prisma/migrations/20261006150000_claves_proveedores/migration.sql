-- Claves fijas de servicios y paquetes (las mismas en todos los catálogos) y
-- proveedores con su comisión. Ver AddOn.clave en schema.prisma.

-- Proveedores
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Proveedor_nombre_key" ON "Proveedor"("nombre");

-- AddOn: clave, proveedor y comisión
ALTER TABLE "AddOn" ADD COLUMN "clave" TEXT;
ALTER TABLE "AddOn" ADD COLUMN "proveedorId" TEXT;
ALTER TABLE "AddOn" ADD COLUMN "comisionPct" DOUBLE PRECISION;

-- Los clones de un catálogo copian nombre y tipo de cobro: el mismo servicio en
-- dos años es el que tiene el mismo nombre y tipo. Si un catálogo repite un
-- nombre, se emparejan por orden de alta (`n`). La clave es el id más antiguo
-- del grupo.
WITH g AS (
  SELECT "id", "nombre", "kind",
         ROW_NUMBER() OVER (PARTITION BY "priceListId", "nombre", "kind" ORDER BY "id") AS n
  FROM "AddOn"
), c AS (
  SELECT "id", MIN("id") OVER (PARTITION BY "nombre", "kind", n) AS clave FROM g
)
UPDATE "AddOn" a SET "clave" = c.clave FROM c WHERE a."id" = c."id";

ALTER TABLE "AddOn" ALTER COLUMN "clave" SET NOT NULL;
CREATE UNIQUE INDEX "AddOn_priceListId_clave_key" ON "AddOn"("priceListId", "clave");
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_comisionPct_check" CHECK ("comisionPct" IS NULL OR ("comisionPct" >= 0 AND "comisionPct" <= 100));

-- FoodPackage: clave (mismo paquete = mismo tipo de evento y nombre)
ALTER TABLE "FoodPackage" ADD COLUMN "clave" TEXT;
WITH g AS (
  SELECT "id", "eventTypeId", "nombre",
         ROW_NUMBER() OVER (PARTITION BY "priceListId", "eventTypeId", "nombre" ORDER BY "id") AS n
  FROM "FoodPackage"
), c AS (
  SELECT "id", MIN("id") OVER (PARTITION BY "eventTypeId", "nombre", n) AS clave FROM g
)
UPDATE "FoodPackage" f SET "clave" = c.clave FROM c WHERE f."id" = c."id";
ALTER TABLE "FoodPackage" ALTER COLUMN "clave" SET NOT NULL;
CREATE UNIQUE INDEX "FoodPackage_priceListId_clave_key" ON "FoodPackage"("priceListId", "clave");
