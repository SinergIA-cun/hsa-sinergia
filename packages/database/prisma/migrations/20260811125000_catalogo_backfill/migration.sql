-- Fusión de datos ENTRE las dos migraciones del catálogo versionado.
--
-- Por qué es una migración y no solo el script `backfill:fase13`: el contenedor
-- arranca con `migrate:deploy` (que aplica TODAS las migraciones pendientes) y
-- solo después corre los backfills de TypeScript. Si la fusión viviera nada más
-- en el script, el `SET NOT NULL` de la fase 2 se aplicaría antes que él y
-- fallaría sobre las cotizaciones sin catálogo. Aquí queda garantizado el orden:
-- fase 1 (columnas) → fusión (datos) → fase 2 (obligatoriedad y drops).
--
-- Idempotente: sobre una base ya fundida no toca nada.
DO $$
DECLARE
  canon_id   TEXT;
  canon_anio INTEGER;
  cap_id     TEXT;
  cap_uso    INTEGER;
BEGIN
  -- El catálogo canónico: la lista 'dia' del año más reciente.
  SELECT "id", "anio" INTO canon_id, canon_anio
    FROM "PriceList" WHERE "tipo" = 'dia' ORDER BY "anio" DESC LIMIT 1;

  IF canon_id IS NULL THEN
    RAISE NOTICE 'No hay PriceList tipo "dia" (base nueva): nada que fundir.';
    RETURN;
  END IF;

  -- El canónico se nombra, se activa y absorbe los parámetros del singleton
  -- PricingConfig, que era la última fuente global capaz de represiar TODA
  -- cotización al reeditarla.
  UPDATE "PriceList" SET
    "nombre"           = COALESCE("nombre", canon_anio::TEXT),
    "activa"           = TRUE,
    "ivaRate"          = COALESCE((SELECT "ivaRate"          FROM "PricingConfig" WHERE "id" = 'default'), "ivaRate"),
    "extraHourRate"    = COALESCE((SELECT "extraHourRate"    FROM "PricingConfig" WHERE "id" = 'default'), "extraHourRate"),
    "foodDiscountRate" = COALESCE((SELECT "foodDiscountRate" FROM "PricingConfig" WHERE "id" = 'default'), "foodDiscountRate"),
    "capillaSabado"    = COALESCE((SELECT "capillaSabado"    FROM "PricingConfig" WHERE "id" = 'default'), "capillaSabado")
  WHERE "id" = canon_id;

  -- Los renglones de las listas 'plano' se mudan al catálogo, marcados como tal.
  UPDATE "RentalPrice" SET "priceListId" = canon_id, "tipo" = 'plano'
   WHERE "priceListId" IN (SELECT "id" FROM "PriceList" WHERE "tipo" = 'plano' AND "id" <> canon_id);
  DELETE FROM "PriceList" WHERE "tipo" = 'plano' AND "id" <> canon_id;

  -- El activo es uno y solo uno; los catálogos de años anteriores se conservan.
  UPDATE "PriceList" SET "activa" = FALSE WHERE "id" <> canon_id AND "activa";

  -- Servicios, paquetes de alimentos y cotizaciones huérfanos se casan al catálogo.
  UPDATE "AddOn"       SET "priceListId" = canon_id WHERE "priceListId" IS NULL;
  UPDATE "FoodPackage" SET "priceListId" = canon_id WHERE "priceListId" IS NULL;
  UPDATE "Quote"       SET "priceListId" = canon_id WHERE "priceListId" IS NULL;

  -- El espacio vestigial "La Capilla": el negocio la trata como casilla con
  -- tarifa de sábado (PriceList.capillaSabado), no como salón rentable. Si
  -- alguna cotización la referencia NO se borra: perder el nombre de un espacio
  -- ya cotizado haría que el contrato imprima un cuid.
  SELECT "id" INTO cap_id FROM "Space" WHERE "nombre" LIKE '%apilla%' ORDER BY "id" LIMIT 1;
  IF cap_id IS NOT NULL THEN
    SELECT count(*) INTO cap_uso FROM "Quote" WHERE cap_id = ANY("spaceIds");
    IF cap_uso > 0 THEN
      RAISE NOTICE 'ATENCION: "La Capilla" (%) la referencian % cotizaciones. NO se borra.', cap_id, cap_uso;
    ELSE
      DELETE FROM "RentalPrice"      WHERE "spaceId" = cap_id;
      DELETE FROM "SpacePaymentRule" WHERE "spaceId" = cap_id;
      DELETE FROM "Space"            WHERE "id"      = cap_id;
    END IF;
  END IF;
END $$;
