-- Capilla compartida: varios eventos pueden usarla el mismo día; se captura su horario.
ALTER TABLE "Quote" ADD COLUMN "capillaHorario" TEXT;
