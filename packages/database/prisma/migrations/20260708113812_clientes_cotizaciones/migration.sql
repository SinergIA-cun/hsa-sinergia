-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "correo" TEXT,
    "empresa" TEXT,
    "domicilio" TEXT,
    "identificacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "fechaEvento" TIMESTAMP(3) NOT NULL,
    "horasEvento" INTEGER,
    "invitados" INTEGER NOT NULL,
    "spaceIds" TEXT[],
    "horasExtra" INTEGER NOT NULL DEFAULT 0,
    "foodPackageId" TEXT,
    "addOns" JSONB NOT NULL DEFAULT '[]',
    "breakdown" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "rentaTotal" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'borrador',
    "publicToken" TEXT NOT NULL,
    "vigenciaHasta" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_publicToken_key" ON "Quote"("publicToken");

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
