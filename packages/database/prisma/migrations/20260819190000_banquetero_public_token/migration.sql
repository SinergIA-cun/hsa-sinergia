-- El enlace compartible del estado de cuenta del banquetero (Plan H, Task 3).
--
-- Decisión 2 del dueño: sección interna + enlace de solo lectura. Sin usuarios
-- externos y sin contraseñas, igual que el enlace de la cotización del cliente.
--
-- El default es de POSTGRES y no de la aplicación: hay seis lugares que crean
-- banqueteros (seed, panel de admin, cuatro suites de prueba) y un token generado
-- en código obliga a acordarse en todos. Así una fila sin token no puede existir.
--
-- `gen_random_uuid()` es VOLATILE, así que Postgres NO usa el atajo de "un solo
-- valor almacenado" del `ADD COLUMN ... DEFAULT`: lo evalúa POR FILA y cada
-- banquetero existente queda con su propio token. Si fuera estable, todos
-- compartirían el mismo y el índice único fallaría — o peor, no fallaría y un
-- enlace serviría para ver a todos.
--
-- NOTA: `prisma migrate diff` repetirá este default en cada corrida, igual que los
-- `nextval` de `client_ref_seq` y `recibo_folio_seq`. Junto con ellos, el diff
-- reintroduce `DROP SEQUENCE` para esas dos secuencias: hay que borrarlo A MANO —
-- romper `recibo_folio_seq` mata el folio de los recibos.

-- AlterTable
ALTER TABLE "Banquetero" ADD COLUMN "publicToken" TEXT NOT NULL DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

-- CreateIndex
CREATE UNIQUE INDEX "Banquetero_publicToken_key" ON "Banquetero"("publicToken");
