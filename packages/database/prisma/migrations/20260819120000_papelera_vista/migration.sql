-- Contador de papelera sin ver (punto 1 del Plan G).
--
-- El sello es POR USUARIO, no un estado por cotización: "sin ver" es propiedad de
-- quien mira. Nullable y sin default: los usuarios existentes quedan en NULL, que
-- significa "nunca ha abierto la papelera" y hace que toda su papelera cuente —el
-- comportamiento correcto para la primera vez que entran.
--
-- Lo que NO va aquí, aunque `prisma migrate diff` lo reintroduzca en CADA diff:
--   DROP SEQUENCE "client_ref_seq" / DROP SEQUENCE "recibo_folio_seq".
-- Es deriva histórica de 20260710163602_ref_folio_comprobante. Ejecutarlo
-- rompería el folio de los recibos y el número de referencia del cliente.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "papeleraVistaAt" TIMESTAMP(3);
