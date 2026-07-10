/*
  Warnings:

  - You are about to drop the column `comprobantePendiente` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `comprobanteUrl` on the `Payment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "comprobantePendiente",
DROP COLUMN "comprobanteUrl";
