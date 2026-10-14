-- Comisión que la agencia (el banquetero del evento) le paga a la hacienda por
-- el paquete de alimentos, en porcentaje del subtotal sin IVA (BI #4, 13-oct-2026).
ALTER TABLE "FoodPackage" ADD COLUMN "comisionPct" DOUBLE PRECISION;
ALTER TABLE "FoodPackage" ADD CONSTRAINT "FoodPackage_comisionPct_check" CHECK ("comisionPct" IS NULL OR ("comisionPct" >= 0 AND "comisionPct" <= 100));

-- El mismo paquete con otra captura en otro catálogo ("Taquiza" / "TAQUIZA",
-- "SUPREME plus" / "SUPREME PLUS") quedó con dos claves porque las claves se
-- emparejaron por nombre exacto. Mismo tipo de evento y mismo nombre sin
-- distinguir mayúsculas ni espacios = mismo paquete: se quedan con la clave del
-- más antiguo. Solo si en cada catálogo hay uno: si un catálogo trae dos, no se
-- adivina cuál es cuál.
WITH n AS (
  SELECT "id", "priceListId", "eventTypeId", "clave",
         lower(regexp_replace(btrim("nombre"), '\s+', ' ', 'g')) AS nombre
  FROM "FoodPackage"
), grupos AS (
  SELECT "eventTypeId", nombre
  FROM n
  GROUP BY "eventTypeId", nombre
  HAVING count(DISTINCT "clave") > 1 AND count(*) = count(DISTINCT "priceListId")
), destino AS (
  SELECT DISTINCT ON (n."eventTypeId", n.nombre) n."eventTypeId", n.nombre, n."clave"
  FROM n JOIN grupos g ON g."eventTypeId" = n."eventTypeId" AND g.nombre = n.nombre
  ORDER BY n."eventTypeId", n.nombre, n."id"
)
UPDATE "FoodPackage" f
SET "clave" = d."clave"
FROM n JOIN destino d ON d."eventTypeId" = n."eventTypeId" AND d.nombre = n.nombre
WHERE f."id" = n."id" AND f."clave" <> d."clave";
