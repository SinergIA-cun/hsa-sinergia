-- Código de evento (punto 5 del Plan G): `17ENE-CBOLADO-CUPULA`.
--
-- Nullable + índice único: en Postgres un índice único deja pasar varios NULL,
-- así que las cotizaciones existentes conviven sin código hasta que el backfill
-- (`backfill:fase15`) las llena. El sufijo `-2` lo pone el servicio; la base de
-- datos solo garantiza que no haya dos iguales.
--
-- Lo que NO va aquí, aunque `prisma migrate diff` lo reintroduzca en CADA diff:
--   DROP SEQUENCE "client_ref_seq" / DROP SEQUENCE "recibo_folio_seq".
-- Es deriva histórica de 20260710163602_ref_folio_comprobante. Ejecutarlo
-- rompería el folio de los recibos —que es justo lo que el recibo imprime— y el
-- número de referencia del cliente.

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "codigo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_codigo_key" ON "Quote"("codigo");
