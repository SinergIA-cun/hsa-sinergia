-- `lpad(texto, 4)` RECORTA cuando el texto es más largo: con el consecutivo en
-- 10045 el folio salía "26OCT-1004" y chocaba con otro. Ahora rellena a 4 dígitos
-- como mínimo y nunca recorta. Los folios ya emitidos no cambian.
CREATE OR REPLACE FUNCTION folio_evento() RETURNS text
LANGUAGE sql AS $$
  SELECT to_char(now() - interval '6 hours', 'YY')
      || (ARRAY['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'])[
           EXTRACT(MONTH FROM now() - interval '6 hours')::int]
      || '-'
      || (SELECT lpad(n::text, greatest(4, length(n::text)), '0') FROM (SELECT nextval('evento_folio_seq') AS n) s);
$$;
