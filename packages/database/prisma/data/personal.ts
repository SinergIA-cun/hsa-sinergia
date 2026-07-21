import type { PrismaClient } from '@prisma/client';

// Personal HSA base (tomado de las hojas operativas). El cliente agrega/edita
// empleados y arma sus cuadrillas desde el panel de administración.
const EMPLEADOS: { nombre: string; rol?: string }[] = [
  { nombre: 'Miriam' },
  { nombre: 'Gabriel', rol: 'Suplente' },
  { nombre: 'Gerardo' },
  { nombre: 'Viviana' },
  { nombre: 'Efrén' },
  { nombre: 'Lupe' },
  { nombre: 'Brígido' },
  { nombre: 'Comodín', rol: 'Comodín' },
  { nombre: 'Jefe de área', rol: 'Jefe de área' },
];

// Una cuadrilla de ejemplo con algunos de esos empleados.
const CUADRILLA_EJEMPLO = {
  nombre: 'Cuadrilla A',
  miembros: ['Miriam', 'Gabriel', 'Gerardo', 'Comodín', 'Jefe de área'],
};

/** Crea (idempotente, por nombre) el personal y una cuadrilla de ejemplo. */
export async function applyPersonal(prisma: PrismaClient): Promise<void> {
  for (const e of EMPLEADOS) {
    const existe = await prisma.empleado.findFirst({ where: { nombre: e.nombre } });
    if (!existe) await prisma.empleado.create({ data: { nombre: e.nombre, rol: e.rol ?? null } });
  }

  const yaHayCuadrilla = await prisma.cuadrilla.findFirst({ where: { nombre: CUADRILLA_EJEMPLO.nombre } });
  if (!yaHayCuadrilla) {
    const empleados = await prisma.empleado.findMany({ where: { nombre: { in: CUADRILLA_EJEMPLO.miembros } } });
    await prisma.cuadrilla.create({
      data: {
        nombre: CUADRILLA_EJEMPLO.nombre,
        miembros: { create: empleados.map((e) => ({ empleadoId: e.id })) },
      },
    });
  }
}
