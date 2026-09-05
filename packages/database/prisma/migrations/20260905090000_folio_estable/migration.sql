-- El folio del evento: la identidad que NO cambia.
--
-- El código anterior (`29OCT27-CBARRERA-CUPULA`) mezclaba dos trabajos que se
-- contradicen: identificar —no cambiar nunca, porque está impreso en un recibo
-- que el cliente tiene— y describir —estar siempre al día—. Como era uno solo,
-- se congelaba al formalizar para no romper los recibos, y desde ese momento
-- mentía: hay una prueba en el repo donde un evento movido al 9 de mayo conserva
-- un código que dice 21 de marzo.
--
-- Aquí se parten en dos:
--   · `folio`    identifica. `27SEP-0184`: año y mes de CONTRATACIÓN —hechos
--                históricos, a diferencia de la fecha del evento, que se mueve—
--                más un consecutivo.
--   · `etiqueta` describe. Se recalcula siempre, no es única, no se congela.
--
CREATE SEQUENCE IF NOT EXISTS evento_folio_seq;

-- El folio se arma en la base y no en la aplicación, igual que
-- `Banquetero.publicToken`: así una fila sin folio no puede existir, y `nextval`
-- es atómico, de modo que dos altas simultáneas no pueden chocar.
--
-- `- 6 horas` es el día civil de México, la misma convención que `hoyCivilMexico()`
-- en el código: un evento dado de alta a las 5 de la tarde del 31 de diciembre
-- sigue perteneciendo al año que termina.
--
-- El mes va en letras porque es como el resto de la aplicación escribe las
-- fechas (`29OCT27`), y porque "veintisiete-SEP-ciento ochenta y cuatro" se
-- dicta por teléfono sin que nadie pregunte si el 09 era mes o día.
--
-- El consecutivo NO se reinicia cada mes: así el número por sí solo ya identifica
-- al evento ("el 184"), y el año con el mes delante son legibilidad, no parte de
-- la llave.
CREATE OR REPLACE FUNCTION folio_evento() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT to_char(now() - interval '6 hours', 'YY')
      || (ARRAY['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'])[
           EXTRACT(MONTH FROM now() - interval '6 hours')::int]
      || '-'
      || lpad(nextval('evento_folio_seq')::text, 4, '0');
$$;

-- `folio_evento()` es VOLATILE, así que Postgres la evalúa POR FILA al agregar la
-- columna: las cotizaciones que ya existen reciben cada una su propio folio, no
-- todas el mismo. (Misma propiedad que ya se aprovechó con `gen_random_uuid()`
-- en `Banquetero.publicToken`.)
ALTER TABLE "Quote" ADD COLUMN "folio" text NOT NULL DEFAULT folio_evento();

CREATE UNIQUE INDEX "Quote_folio_key" ON "Quote" ("folio");

-- El código pasa a ser la etiqueta: se le quita la unicidad, que era lo que
-- obligaba a los sufijos `-2`/`-3`. La unicidad ahora la carga el folio, que es
-- único por construcción.
DROP INDEX IF EXISTS "Quote_codigo_key";
ALTER TABLE "Quote" RENAME COLUMN "codigo" TO "etiqueta";

-- El histórico guarda los dos: el folio ancla todas las fotos de un evento entre
-- sí, la etiqueta dice cómo se describía cuando se tomó cada una.
ALTER TABLE "EventoHistorico" RENAME COLUMN "codigo" TO "etiqueta";
ALTER TABLE "EventoHistorico" ADD COLUMN "folio" text;
