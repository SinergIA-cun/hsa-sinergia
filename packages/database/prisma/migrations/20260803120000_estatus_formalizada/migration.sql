-- El negocio considera FORMALIZADO el evento desde que el cliente da el apartado.
-- Se recorren los nombres del enum sin perder información:
--   'apartada'    (pagó anticipo)    -> 'formalizada'
--   'formalizada' (pagó complemento) -> 'complementada'
-- El orden importa: primero se libera el nombre 'formalizada'.
ALTER TYPE "QuoteStatus" RENAME VALUE 'formalizada' TO 'complementada';
ALTER TYPE "QuoteStatus" RENAME VALUE 'apartada' TO 'formalizada';
