-- Periodos de fechas casados a una lista de precios (24-nov-2026).
--
-- Al cotizar, la fecha del evento escoge la lista: el periodo más corto que la
-- contenga gana. Ver `@hsa/shared` → `listaParaFecha`.

CREATE TABLE "PeriodoLista" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodoLista_pkey" PRIMARY KEY ("id"),
    -- Un periodo al revés no contiene ninguna fecha: se rechaza en la base y no
    -- solo en la API.
    CONSTRAINT "PeriodoLista_desde_hasta_check" CHECK ("desde" <= "hasta")
);

CREATE INDEX "PeriodoLista_desde_hasta_idx" ON "PeriodoLista"("desde", "hasta");

ALTER TABLE "PeriodoLista" ADD CONSTRAINT "PeriodoLista_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La bitácora forense también la cubre.
SELECT asegurar_auditoria();
