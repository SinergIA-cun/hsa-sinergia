-- Copia de datos ENTRE las dos migraciones del DJ por catálogo.
--
-- Por qué es una migración y no solo el script `backfill:fase14`: el contenedor
-- arranca con `migrate:deploy` (que aplica TODAS las migraciones pendientes) y
-- solo DESPUÉS corre los backfills de TypeScript. Si la copia viviera nada más
-- en el script, el `DROP COLUMN "djHoraExtra"` de la fase 2 se aplicaría antes
-- que él y los precios del folleto se perderían sin que nadie se enterara: la
-- casilla del DJ dejaría de cobrar en silencio. Aquí queda garantizado el orden:
-- fase 1 (tabla) → copia (datos) → fase 2 (DROP COLUMN).
--
-- Idempotente por el `ON CONFLICT`: sobre una base ya copiada no toca nada.
-- Sobre una base donde la columna ya cayó (fase 2 aplicada) tampoco corre: el
-- bloque entero está detrás de la comprobación de existencia.
DO $$
DECLARE
  copiados INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'EventType' AND column_name = 'djHoraExtra'
  ) THEN
    RAISE NOTICE 'EventType."djHoraExtra" ya no existe: nada que copiar.';
    RETURN;
  END IF;

  -- Un renglón por CADA catálogo × CADA tipo de evento con precio. Todos los
  -- catálogos, no solo el activo: un catálogo viejo sin sus renglones dejaría de
  -- cobrar el DJ al reeditar una cotización de ese año, que es exactamente el
  -- represiado silencioso que este diseño mata.
  --
  -- Los tipos con `djHoraExtra` NULL (graduación, renta, team building) se
  -- quedan SIN renglón a propósito: sin renglón = no se ofrece el servicio.
  EXECUTE $ins$
    INSERT INTO "DjHoraExtraPrice" ("id", "priceListId", "eventTypeId", "price")
    SELECT
      -- cuid() no existe en Postgres; un id determinista y legible basta, y no
      -- colisiona con los cuid de Prisma.
      'dj_' || pl."id" || '_' || et."id",
      pl."id",
      et."id",
      et."djHoraExtra"
      FROM "PriceList" pl
      CROSS JOIN "EventType" et
     WHERE et."djHoraExtra" IS NOT NULL
    ON CONFLICT ("priceListId", "eventTypeId") DO NOTHING
  $ins$;
  GET DIAGNOSTICS copiados = ROW_COUNT;
  RAISE NOTICE 'Precios de DJ copiados al catálogo: %', copiados;
END $$;
