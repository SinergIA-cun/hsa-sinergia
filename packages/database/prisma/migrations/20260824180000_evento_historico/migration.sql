-- La foto de un evento cuya fecha ya pasó.
--
-- Es de solo agregar: una corrección posterior escribe una versión nueva, nunca
-- encima. El `@@unique(quoteId, version)` es lo que lo garantiza en la base y no
-- solo en el código.
--
-- Ojo: esta tabla nace DESPUÉS de la bitácora forense, así que no la cubre la
-- migración que enganchó los triggers. La engancha `asegurar_auditoria()` al
-- arrancar el contenedor — es justo el caso para el que se escribió esa función.

CREATE TABLE "EventoHistorico" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "fechaEvento" TIMESTAMP(3) NOT NULL,
    "codigo" TEXT,
    "foto" JSONB NOT NULL,
    "cliente" TEXT NOT NULL,
    "banquetero" TEXT,
    "eventoTipo" TEXT NOT NULL,
    "espacios" TEXT[],
    "total" INTEGER NOT NULL,
    "pagado" INTEGER NOT NULL,
    "saldo" INTEGER NOT NULL,
    "seRealizo" BOOLEAN NOT NULL,
    "liquidado" BOOLEAN NOT NULL,
    "busqueda" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoHistorico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventoHistorico_fechaEvento_idx" ON "EventoHistorico"("fechaEvento" DESC);
CREATE INDEX "EventoHistorico_busqueda_idx" ON "EventoHistorico"("busqueda");
CREATE UNIQUE INDEX "EventoHistorico_quoteId_version_key" ON "EventoHistorico"("quoteId", "version");

ALTER TABLE "EventoHistorico" ADD CONSTRAINT "EventoHistorico_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
