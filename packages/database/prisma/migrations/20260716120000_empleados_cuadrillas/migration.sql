-- Personal HSA: empleados + cuadrillas (grupos) para armar la hoja operativa.
CREATE TABLE "Empleado" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "rol" TEXT,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cuadrilla" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Cuadrilla_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CuadrillaMiembro" (
  "id" TEXT NOT NULL,
  "cuadrillaId" TEXT NOT NULL,
  "empleadoId" TEXT NOT NULL,
  CONSTRAINT "CuadrillaMiembro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuadrillaMiembro_cuadrillaId_empleadoId_key" ON "CuadrillaMiembro"("cuadrillaId", "empleadoId");
CREATE INDEX "CuadrillaMiembro_cuadrillaId_idx" ON "CuadrillaMiembro"("cuadrillaId");
CREATE INDEX "CuadrillaMiembro_empleadoId_idx" ON "CuadrillaMiembro"("empleadoId");

ALTER TABLE "CuadrillaMiembro" ADD CONSTRAINT "CuadrillaMiembro_cuadrillaId_fkey" FOREIGN KEY ("cuadrillaId") REFERENCES "Cuadrilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CuadrillaMiembro" ADD CONSTRAINT "CuadrillaMiembro_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
