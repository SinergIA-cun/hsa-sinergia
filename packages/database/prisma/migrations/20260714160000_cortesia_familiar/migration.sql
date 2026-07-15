-- Cortesía familiar: bandera para pintar el evento en verde en la agenda.
ALTER TABLE "Quote" ADD COLUMN "esCortesia" BOOLEAN NOT NULL DEFAULT false;
