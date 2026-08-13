-- Fase 1 del DJ por catálogo: nace la tabla, y NADA más.
--
-- Lo que NO va aquí (va en la fase 2, después del backfill fase14):
--   · DROP COLUMN "djHoraExtra" en "EventType" — el backfill lo LEE para copiar
--     los valores. Dropearlo antes pierde los $2,950 / $2,750 del folleto.
--
-- Tampoco va el DROP SEQUENCE de client_ref_seq / recibo_folio_seq que Prisma
-- vuelve a meter en CADA diff: es deriva histórica de los
-- `dbgenerated("nextval(...)")` de 20260710163602_ref_folio_comprobante, no un
-- cambio de esta task. Ejecutarlo rompería el folio de los recibos y el número
-- de referencia del cliente.

-- CreateTable
CREATE TABLE "DjHoraExtraPrice" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "DjHoraExtraPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El único índice necesario: el compuesto sirve también para el
-- `WHERE priceListId = ?` del loader, porque priceListId es su prefijo.
CREATE UNIQUE INDEX "DjHoraExtraPrice_priceListId_eventTypeId_key" ON "DjHoraExtraPrice"("priceListId", "eventTypeId");

-- AddForeignKey
ALTER TABLE "DjHoraExtraPrice" ADD CONSTRAINT "DjHoraExtraPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DjHoraExtraPrice" ADD CONSTRAINT "DjHoraExtraPrice_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
