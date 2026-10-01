-- Los espacios se llaman corto, sin "Jardín" ni "Salón" (decisión del dueño).
UPDATE "Space" SET nombre = 'Cúpula'    WHERE nombre = 'Jardín La Cúpula';
UPDATE "Space" SET nombre = 'Campos'    WHERE nombre = 'Jardín Los Campos';
UPDATE "Space" SET nombre = 'Arcos'     WHERE nombre = 'Salón Los Arcos';
UPDATE "Space" SET nombre = 'Balcones'  WHERE nombre = 'Salón Los Balcones';
UPDATE "Space" SET nombre = 'Pajaritos' WHERE nombre = 'Salón Los Pajaritos';

-- El desglose de cada evento guarda copiado el nombre del espacio en su renglón
-- de renta ("Renta Salón Los Arcos"). Se pone al día para que el contrato, la
-- página del cliente y el recibo digan lo mismo que el resto. Los precios no se
-- tocan. Las fotos del histórico (`EventoHistorico`) se quedan como estaban:
-- son el retrato de un día.
UPDATE "Quote"
SET breakdown = replace(replace(replace(replace(replace(breakdown::text,
      'Jardín La Cúpula', 'Cúpula'),
      'Jardín Los Campos', 'Campos'),
      'Salón Los Arcos', 'Arcos'),
      'Salón Los Balcones', 'Balcones'),
      'Salón Los Pajaritos', 'Pajaritos')::jsonb
WHERE breakdown::text ~ '(Jardín La Cúpula|Jardín Los Campos|Salón Los Arcos|Salón Los Balcones|Salón Los Pajaritos)';
