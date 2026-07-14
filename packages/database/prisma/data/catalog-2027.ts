import type { PrismaClient } from '@prisma/client';

// Catálogo 2027 de tipos de evento y paquetes de alimentos (fuente única).
// Transcrito de los 7 PDFs de "Cotizaciones HSA" y verificado con el cliente.
// Lo usan tanto el seed (BD nueva) como el backfill (producción), aplicándolo
// de forma idempotente: preserva los ids de paquetes existentes (por nombre) y
// solo refresca sus precios; crea los que falten.

export interface Bracket {
  min: number;
  max: number | null; // null = sin tope
  pricePerPerson: number; // sin IVA
}

export interface PackageDef {
  nombre: string;
  brackets: Bracket[];
}

export interface EventTypeDef {
  nombre: string;
  slug: string;
  packages: PackageDef[]; // vacío = solo renta del espacio
}

/** Empareja rangos [min,max] con un arreglo de precios (mismo orden). */
function zip(bounds: [number, number | null][], precios: number[]): Bracket[] {
  return bounds.map(([min, max], i) => ({ min, max, pricePerPerson: precios[i]! }));
}

// Rangos de invitados del folleto de alimentos por familia de evento.
const B_XV: [number, number | null][] = [
  [50, 99], [100, 150], [151, 200], [201, 300], [301, 400], [401, 500],
];
const B_BODA: [number, number | null][] = [
  [1, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, null],
];
const B_EMP: [number, number | null][] = [
  [1, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500], [501, 600], [601, 700], [701, 800],
];

// Los 7 paquetes de Empresarial (y Fin de año, que reusa los mismos).
const EMPRESARIAL_PACKAGES: PackageDef[] = [
  { nombre: '3 Tiempos', brackets: zip(B_EMP, [680, 660, 630, 620, 610, 596, 586, 586, 576]) },
  { nombre: '4 Tiempos', brackets: zip(B_EMP, [730, 700, 680, 670, 660, 650, 650, 640, 640]) },
  { nombre: 'Buffet Mexicano', brackets: zip(B_EMP, [670, 630, 580, 565, 555, 545, 545, 535, 535]) },
  { nombre: 'Casino', brackets: zip(B_EMP, [1030, 920, 825, 795, 775, 765, 755, 755, 745]) },
  { nombre: 'Kermesse', brackets: zip(B_EMP, [845, 825, 805, 795, 775, 765, 755, 745, 745]) },
  { nombre: 'Fiesta Vaquera', brackets: zip(B_EMP, [1030, 885, 805, 775, 755, 730, 710, 710, 710]) },
  { nombre: 'Parrillada', brackets: zip(B_EMP, [765, 710, 700, 680, 660, 660, 650, 650, 650]) },
];

// Cumpleaños y Bautizo comparten los mismos paquetes y precios.
const TRES_TIEMPOS_TAQUIZA: PackageDef[] = [
  { nombre: '3 Tiempos', brackets: zip(B_XV, [1230, 945, 930, 920, 910, 890]) },
  { nombre: 'Taquiza', brackets: zip(B_XV, [1210, 935, 920, 910, 900, 880]) },
];

export const EVENT_TYPES_2027: EventTypeDef[] = [
  {
    nombre: 'Boda',
    slug: 'boda',
    packages: [
      { nombre: 'SUPREME', brackets: zip(B_BODA, [1459, 1019, 999, 849, 799, 679]) },
      { nombre: 'SUPREME plus', brackets: zip(B_BODA, [1729, 1199, 1179, 969, 899, 789]) },
    ],
  },
  {
    nombre: 'XV',
    slug: 'xv',
    packages: [{ nombre: 'Servicio de Alimentos', brackets: zip(B_XV, [1290, 1015, 999, 989, 979, 969]) }],
  },
  { nombre: 'Cumpleaños', slug: 'cumpleanos', packages: TRES_TIEMPOS_TAQUIZA },
  { nombre: 'Bautizo', slug: 'bautizo', packages: TRES_TIEMPOS_TAQUIZA },
  { nombre: 'Empresarial', slug: 'empresarial', packages: EMPRESARIAL_PACKAGES },
  { nombre: 'Fin de año', slug: 'fin-de-ano', packages: EMPRESARIAL_PACKAGES },
  // Solo renta del espacio (sin alimentos):
  { nombre: 'Renta', slug: 'renta', packages: [] },
  { nombre: 'Graduación', slug: 'graduacion', packages: [] },
];

/**
 * Aplica el catálogo 2027 de tipos de evento + alimentos de forma idempotente.
 * También normaliza el nombre del add-on de DJ a "DJ Hora extra".
 * NO toca espacios, rentas ni reglas de pago (los maneja el seed/otras fases).
 */
export async function applyCatalog2027(prisma: PrismaClient): Promise<void> {
  for (const et of EVENT_TYPES_2027) {
    const type = await prisma.eventType.upsert({
      where: { slug: et.slug },
      update: { nombre: et.nombre },
      create: { nombre: et.nombre, slug: et.slug },
    });

    for (const pkg of et.packages) {
      const existing = await prisma.foodPackage.findFirst({
        where: { eventTypeId: type.id, nombre: pkg.nombre },
      });
      const paquete =
        existing ??
        (await prisma.foodPackage.create({
          data: { eventTypeId: type.id, nombre: pkg.nombre, ivaIncluido: false },
        }));
      // Reemplaza los precios (preserva el id del paquete para no romper cotizaciones existentes).
      await prisma.foodPackagePrice.deleteMany({ where: { packageId: paquete.id } });
      await prisma.foodPackagePrice.createMany({
        data: pkg.brackets.map((b) => ({
          packageId: paquete.id,
          min: b.min,
          max: b.max,
          pricePerPerson: b.pricePerPerson,
        })),
      });
    }
  }

  // "DJ (por hora)" → "DJ Hora extra" (el precio por tipo de evento llega en la Etapa 2).
  await prisma.addOn.updateMany({
    where: { nombre: 'DJ (por hora)' },
    data: { nombre: 'DJ Hora extra' },
  });

  // La Capilla deja de ser un espacio cotizable: ahora es una cortesía por-evento
  // (toggle "usaCapilla", $5,000 en sábado). Se desactiva para que no aparezca en
  // el selector de espacios, pero se conserva la fila por historial.
  await prisma.space.updateMany({
    where: { nombre: 'La Capilla' },
    data: { activo: false },
  });
}
