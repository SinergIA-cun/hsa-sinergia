-- El código del evento pasa a ser el principal y guarda su historial.

CREATE TABLE "CodigoEvento" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "motivos" TEXT[],
    "fechaEvento" TIMESTAMP(3) NOT NULL,
    "spaceIds" TEXT[],
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodigoEvento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CodigoEvento_quoteId_createdAt_idx" ON "CodigoEvento"("quoteId", "createdAt");
CREATE INDEX "CodigoEvento_codigo_idx" ON "CodigoEvento"("codigo");
ALTER TABLE "CodigoEvento" ADD CONSTRAINT "CodigoEvento_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodigoEvento" ADD CONSTRAINT "CodigoEvento_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Como ya es el identificador principal, dos eventos vivos no pueden compartirlo:
-- los repetidos (típicamente una cotización duplicada) llevan sufijo -2, -3… por
-- orden de alta. El primero conserva el suyo.
WITH repetidos AS (
  SELECT id, etiqueta,
         row_number() OVER (PARTITION BY etiqueta ORDER BY "createdAt", id) AS n
  FROM "Quote"
  WHERE "deletedAt" IS NULL AND etiqueta IS NOT NULL
)
UPDATE "Quote" q SET etiqueta = r.etiqueta || '-' || r.n
FROM repetidos r
WHERE q.id = r.id AND r.n > 1;

-- El historial arranca con el código vigente de cada evento. Los cambios de antes
-- no se reconstruyen: el código depende del nombre del cliente en ese momento, y
-- ese dato no se guardó.
INSERT INTO "CodigoEvento" ("id", "quoteId", "codigo", "motivos", "fechaEvento", "spaceIds", "actorId", "createdAt")
SELECT 'ce_' || q.id, q.id, q.etiqueta, ARRAY['alta'], q."fechaEvento", q."spaceIds", q."createdById", q."createdAt"
FROM "Quote" q
WHERE q.etiqueta IS NOT NULL;

SELECT asegurar_auditoria();
