-- DJ Hora extra: precio por tipo de evento + bandera por cotización.
ALTER TABLE "EventType" ADD COLUMN "djHoraExtra" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "usaDjHoraExtra" BOOLEAN NOT NULL DEFAULT false;
