-- El festejado (cliente FINAL) como dato del evento. Con banquetero, él es el
-- cliente de la hacienda —firma él y se le factura a él—, y el festejado es dato
-- operativo: va en la hoja operativa y NO en el contrato.
--
-- Nullable y sin backfill: la enorme mayoría de los eventos no tiene banquetero, y
-- los que capturaron festejado en la hoja operativa lo conservan ahí
-- (`operativa.hoja.nombreFestejado`), que sigue funcionando como respaldo.
--
-- NOTA: `prisma migrate diff` reintroduce en CADA corrida un bloque
-- `DROP SEQUENCE "client_ref_seq"` / `DROP SEQUENCE "recibo_folio_seq"` (no
-- entiende los `dbgenerated(nextval(...))`). Se borró a mano: romper
-- `recibo_folio_seq` mata el folio de los recibos.
ALTER TABLE "Quote" ADD COLUMN "festejado" TEXT,
                    ADD COLUMN "festejadoTelefono" TEXT;
