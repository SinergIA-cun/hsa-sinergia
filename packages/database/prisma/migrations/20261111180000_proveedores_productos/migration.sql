-- Apartado "Proveedores" (11-nov-2026): la ficha completa del proveedor, sus
-- productos con la comisión pactada, y la liga del proveedor y producto en los
-- servicios del evento y los cargos del punto de venta. Todo nuevo es opcional:
-- lo que ya existe no cambia.

ALTER TABLE "Proveedor" ADD COLUMN "giro" TEXT,
ADD COLUMN "contacto" TEXT,
ADD COLUMN "correo" TEXT,
ADD COLUMN "razonSocial" TEXT,
ADD COLUMN "rfc" TEXT,
ADD COLUMN "notas" TEXT;

CREATE TABLE "ProductoProveedor" (
    "id" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DOUBLE PRECISION,
    "comisionPct" DOUBLE PRECISION,
    "comisionMonto" DOUBLE PRECISION,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductoProveedor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductoProveedor_proveedorId_idx" ON "ProductoProveedor"("proveedorId");
CREATE UNIQUE INDEX "ProductoProveedor_proveedorId_nombre_key" ON "ProductoProveedor"("proveedorId", "nombre");
ALTER TABLE "ProductoProveedor" ADD CONSTRAINT "ProductoProveedor_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuoteExtra" ADD COLUMN "proveedorId" TEXT,
ADD COLUMN "productoProveedorId" TEXT;
ALTER TABLE "QuoteExtra" ADD CONSTRAINT "QuoteExtra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteExtra" ADD CONSTRAINT "QuoteExtra_productoProveedorId_fkey" FOREIGN KEY ("productoProveedorId") REFERENCES "ProductoProveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CargoEvento" ADD COLUMN "proveedorId" TEXT,
ADD COLUMN "productoProveedorId" TEXT;
ALTER TABLE "CargoEvento" ADD CONSTRAINT "CargoEvento_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CargoEvento" ADD CONSTRAINT "CargoEvento_productoProveedorId_fkey" FOREIGN KEY ("productoProveedorId") REFERENCES "ProductoProveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
