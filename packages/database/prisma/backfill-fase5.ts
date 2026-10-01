import { prisma } from '../src/index.js';
import { ESPACIOS, buscarEspacio, type ClaveEspacio } from './data/espacios.js';

/**
 * Backfill IDEMPOTENTE de los datos nuevos de Fase 5 para una base de datos que
 * YA tiene catálogo sembrado (producción). El seed normal (`seed:deploy`) se
 * salta todo si ya existen espacios, así que estos datos nuevos hay que
 * agregarlos con este script. Correr una vez tras el deploy.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/database exec tsx prisma/backfill-fase5.ts
 *
 * Nota: `valetRatio` de PricingConfig lo backfillea la migración (default 2.5),
 * y los números de referencia / folios los generan sus secuencias — no hace
 * falta tocarlos aquí.
 */

// Reglas de pago por espacio (sección H del contrato). Los demás espacios
// (Balcones, Pajaritos, Jardín del Caballo, Capilla) quedan sin regla hasta
// tener sus números.
const SPACE_RULES: { espacio: ClaveEspacio; anticipo: number; complementoPct: number }[] = [
  { espacio: 'cupula', anticipo: 25000, complementoPct: 0.25 },
  { espacio: 'arcos', anticipo: 20000, complementoPct: 0.1 },
  { espacio: 'campos', anticipo: 15000, complementoPct: 0.15 },
];

async function main(): Promise<void> {
  // 1. Tipo de evento "Renta" (solo espacio, sin alimentos).
  const renta = await prisma.eventType.findUnique({ where: { slug: 'renta' } });
  if (renta) {
    console.log('· Renta: ya existe');
  } else {
    await prisma.eventType.create({ data: { nombre: 'Renta', slug: 'renta' } });
    console.log('· Renta: creado');
  }

  // 2. Reglas de pago por espacio.
  for (const r of SPACE_RULES) {
    const space = await buscarEspacio(prisma, r.espacio);
    const nombre = ESPACIOS[r.espacio].nombre;
    if (!space) {
      console.log(`· Regla ${nombre}: SIN espacio con ese nombre (revisar) — omitido`);
      continue;
    }
    const existing = await prisma.spacePaymentRule.findUnique({ where: { spaceId: space.id } });
    if (existing) {
      console.log(`· Regla ${nombre}: ya existe`);
      continue;
    }
    await prisma.spacePaymentRule.create({
      data: { spaceId: space.id, anticipo: r.anticipo, complementoPct: r.complementoPct },
    });
    console.log(`· Regla ${nombre}: creada (anticipo ${r.anticipo}, ${Math.round(r.complementoPct * 100)}%)`);
  }

  // 3. DJ pasa a cobrarse por hora (kind fijo → porUnidad). Idempotente.
  const dj = await prisma.addOn.findFirst({ where: { nombre: { startsWith: 'DJ' } } });
  if (dj && dj.kind !== 'porUnidad') {
    await prisma.addOn.update({ where: { id: dj.id }, data: { kind: 'porUnidad', nombre: 'DJ (por hora)' } });
    console.log('· DJ: cambiado a por hora');
  } else {
    console.log('· DJ: ya es por hora (o no existe)');
  }

  const rulesCount = await prisma.spacePaymentRule.count();
  const eventCount = await prisma.eventType.count();
  console.log(`\nListo. Reglas de pago: ${rulesCount} · Tipos de evento: ${eventCount}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
