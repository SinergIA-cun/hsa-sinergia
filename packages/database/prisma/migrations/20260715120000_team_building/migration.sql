-- Team Building: renta plana (segunda lista de precios) + bandera por tipo de evento.
ALTER TABLE "PriceList" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'dia';
ALTER TABLE "EventType" ADD COLUMN "rentaPlana" BOOLEAN NOT NULL DEFAULT false;
