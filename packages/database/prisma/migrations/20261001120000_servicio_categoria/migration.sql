-- Categoría de cada servicio del catálogo, para agruparlos al cotizar.
-- Texto libre del admin; NULL = sin categoría.
ALTER TABLE "AddOn" ADD COLUMN "categoria" TEXT;
