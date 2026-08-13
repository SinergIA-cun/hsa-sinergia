-- Fase 2 del DJ por catálogo: recién ahora muere el precio global.
--
-- `EventType.djHoraExtra` era un precio en pesos GLOBAL. Cae AQUÍ y no en la
-- fase 1 porque 20260813175000_dj_catalogo_backfill lo LEE para copiar los
-- valores a "DjHoraExtraPrice", uno por catálogo. Dropearlo antes se lleva los
-- $2,950 / $2,750 del folleto y la casilla del DJ deja de cobrar en silencio.
--
-- Si esta migración corre sobre una base donde la copia no se hizo, los
-- renglones de DJ quedan vacíos: el problema es el backfill, no forzar esto.
-- Verificación: cada catálogo debería tener un renglón por cada tipo de evento
-- que ofrece el servicio (hoy 6: boda, XV, empresarial, fin de año, bautizo y
-- cumpleaños).
--
-- Igual que en la fase 1, NO va el DROP SEQUENCE de client_ref_seq /
-- recibo_folio_seq que Prisma vuelve a meter en el diff: es deriva histórica, no
-- un cambio de esta task, y ejecutarlo rompería el folio de los recibos.

-- AlterTable
ALTER TABLE "EventType" DROP COLUMN "djHoraExtra";
