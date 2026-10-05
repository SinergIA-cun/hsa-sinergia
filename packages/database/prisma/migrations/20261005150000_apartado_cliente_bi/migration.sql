-- Un apartado puede ser de un cliente directo, no solo de un banquetero, y
-- guarda lo que el BI ya sabe de la fecha: el precio pactado, el tipo de evento
-- y su idBI (idempotencia de la importación). Decisión del dueño, 5-oct-2026.

ALTER TABLE "ApartadoFecha" ALTER COLUMN "banqueteroId" DROP NOT NULL;

ALTER TABLE "ApartadoFecha"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "precioAcordado" INTEGER,
  ADD COLUMN "eventTypeId" TEXT,
  ADD COLUMN "importadoBI" TEXT;

ALTER TABLE "ApartadoFecha"
  ADD CONSTRAINT "ApartadoFecha_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ApartadoFecha_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactamente uno: un apartado sin dueño no tiene a quién devolverle el dinero,
-- y uno con los dos no sabe a quién facturarle.
ALTER TABLE "ApartadoFecha"
  ADD CONSTRAINT "ApartadoFecha_un_titular" CHECK (("banqueteroId" IS NULL) <> ("clientId" IS NULL)),
  ADD CONSTRAINT "ApartadoFecha_precioAcordado_positivo" CHECK ("precioAcordado" IS NULL OR "precioAcordado" > 0);

CREATE UNIQUE INDEX "ApartadoFecha_importadoBI_key" ON "ApartadoFecha"("importadoBI");
CREATE INDEX "ApartadoFecha_clientId_idx" ON "ApartadoFecha"("clientId");
