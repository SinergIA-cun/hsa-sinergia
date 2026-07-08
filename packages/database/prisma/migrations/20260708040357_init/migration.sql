-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('viernes', 'viernesEspecial', 'sabado', 'domAJue');

-- CreateEnum
CREATE TYPE "AddOnKind" AS ENUM ('fijo', 'porPersona', 'porUnidad');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('vendedora', 'admin');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('borrador', 'enviada', 'aceptada', 'apartada', 'liquidada', 'vencida');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('efectivo', 'transferencia', 'tarjeta');

-- CreateEnum
CREATE TYPE "PaymentConcept" AS ENUM ('anticipo', 'aCuenta', 'finiquito');

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "vigencia" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "capacidadMax" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPrice" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "min" INTEGER NOT NULL,
    "max" INTEGER,
    "viernes" INTEGER NOT NULL,
    "viernesEspecial" INTEGER NOT NULL,
    "sabado" INTEGER NOT NULL,
    "domAJue" INTEGER NOT NULL,

    CONSTRAINT "RentalPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPackage" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ivaIncluido" BOOLEAN NOT NULL DEFAULT false,
    "incluye" TEXT,

    CONSTRAINT "FoodPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPackagePrice" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "min" INTEGER NOT NULL,
    "max" INTEGER,
    "pricePerPerson" INTEGER NOT NULL,

    CONSTRAINT "FoodPackagePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "kind" "AddOnKind" NOT NULL,
    "price" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ivaRate" DOUBLE PRECISION NOT NULL DEFAULT 0.16,
    "extraHourRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "foodDiscountRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRule" (
    "id" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "apartarMonto" INTEGER NOT NULL DEFAULT 5000,
    "formalizarPct" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "liquidarDias" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "PaymentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'vendedora',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalPrice_priceListId_spaceId_idx" ON "RentalPrice"("priceListId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventType_slug_key" ON "EventType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRule_eventTypeId_key" ON "PaymentRule"("eventTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "RentalPrice" ADD CONSTRAINT "RentalPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPrice" ADD CONSTRAINT "RentalPrice_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPackage" ADD CONSTRAINT "FoodPackage_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPackagePrice" ADD CONSTRAINT "FoodPackagePrice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "FoodPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRule" ADD CONSTRAINT "PaymentRule_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
