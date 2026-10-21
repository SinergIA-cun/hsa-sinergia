-- Tablas de renta por catálogo (21-oct-2026): nombre, orden y a qué tipos de
-- evento aplica cada una. Sus renglones son los RentalPrice con tipo = clave.
CREATE TABLE "TablaRenta" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "eventTypeIds" TEXT[],
    "orden" INTEGER NOT NULL,

    CONSTRAINT "TablaRenta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TablaRenta_priceListId_clave_key" ON "TablaRenta"("priceListId", "clave");

ALTER TABLE "TablaRenta" ADD CONSTRAINT "TablaRenta_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Las dos de siempre en cada catálogo: "Renta" para los tipos de evento normales
-- y "Renta plana (Team Building)" para los de rentaPlana, solo donde hay renglones planos.
INSERT INTO "TablaRenta" ("id", "priceListId", "clave", "nombre", "eventTypeIds", "orden")
SELECT 'tabr_' || md5(pl."id" || 'dia'), pl."id", 'dia', 'Renta',
       COALESCE((SELECT array_agg(et."id" ORDER BY et."nombre") FROM "EventType" et WHERE NOT et."rentaPlana"), ARRAY[]::TEXT[]), 0
FROM "PriceList" pl;

INSERT INTO "TablaRenta" ("id", "priceListId", "clave", "nombre", "eventTypeIds", "orden")
SELECT 'tabr_' || md5(pl."id" || 'plano'), pl."id", 'plano', 'Renta plana (Team Building)',
       COALESCE((SELECT array_agg(et."id" ORDER BY et."nombre") FROM "EventType" et WHERE et."rentaPlana"), ARRAY[]::TEXT[]), 1
FROM "PriceList" pl
WHERE EXISTS (SELECT 1 FROM "RentalPrice" rp WHERE rp."priceListId" = pl."id" AND rp."tipo" = 'plano');
