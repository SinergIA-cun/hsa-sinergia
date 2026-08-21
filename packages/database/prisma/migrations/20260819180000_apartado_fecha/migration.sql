-- Apartar una fecha sin precio (Plan H, Task 2).
--
-- El caso 3 del dueño: los banqueteros piden 2028 y pagan la fecha sin que los
-- precios existan. Un apartado bloquea fecha y espacios como un evento
-- comprometido —es dinero real sobre una fecha— pero NO tiene total: no es una
-- venta cerrada y no entra a los reportes de ingreso comprometido.
--
-- `depositoMetodo` / `depositoFecha` no venían en el diseño y son necesarios: el
-- pago que nace al convertir el apartado tiene que llevar la fecha en que se
-- RECIBIÓ el dinero, no la de la conversión, o se factura fuera de mes (el mismo
-- riesgo fiscal que la Task 1 arregló en las asignaciones).
--
-- NOTA: `prisma migrate diff` reintroduce en CADA corrida un bloque
-- `DROP SEQUENCE "client_ref_seq"` / `DROP SEQUENCE "recibo_folio_seq"`. Se
-- borraron a mano: romper `recibo_folio_seq` mata el folio de los recibos.

-- CreateTable
CREATE TABLE "ApartadoFecha" (
    "id" TEXT NOT NULL,
    "banqueteroId" TEXT NOT NULL,
    "fechaEvento" TIMESTAMP(3) NOT NULL,
    "spaceIds" TEXT[],
    "priceListId" TEXT,
    "deposito" INTEGER NOT NULL DEFAULT 0,
    "depositoMetodo" "PaymentMethod",
    "depositoFecha" TIMESTAMP(3),
    "vence" TIMESTAMP(3) NOT NULL,
    "nota" TEXT,
    "quoteId" TEXT,
    "createdById" TEXT,
    "canceladoAt" TIMESTAMP(3),
    "canceladoById" TEXT,
    "motivoCancelacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApartadoFecha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApartadoFecha_quoteId_key" ON "ApartadoFecha"("quoteId");

-- CreateIndex
CREATE INDEX "ApartadoFecha_fechaEvento_idx" ON "ApartadoFecha"("fechaEvento");

-- CreateIndex
CREATE INDEX "ApartadoFecha_banqueteroId_idx" ON "ApartadoFecha"("banqueteroId");

-- AddForeignKey
ALTER TABLE "ApartadoFecha" ADD CONSTRAINT "ApartadoFecha_banqueteroId_fkey" FOREIGN KEY ("banqueteroId") REFERENCES "Banquetero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoFecha" ADD CONSTRAINT "ApartadoFecha_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoFecha" ADD CONSTRAINT "ApartadoFecha_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoFecha" ADD CONSTRAINT "ApartadoFecha_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoFecha" ADD CONSTRAINT "ApartadoFecha_canceladoById_fkey" FOREIGN KEY ("canceladoById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
