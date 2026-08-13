import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Baja el precio del DJ por hora extra de `EventType.djHoraExtra` —un precio en
 * pesos GLOBAL— a `DjHoraExtraPrice`, que cuelga de cada catálogo.
 *
 * Crea un renglón por CADA catálogo × CADA tipo de evento con precio. Todos los
 * catálogos, no solo el activo: un catálogo viejo sin sus renglones dejaría de
 * cobrar el DJ al reeditar una cotización de ese año, que es el represiado
 * silencioso que el catálogo versionado vino a matar.
 *
 * Los tipos con precio nulo (hoy graduación, renta y team building) se quedan
 * SIN renglón a propósito: sin renglón = ese tipo de evento no ofrece el
 * servicio.
 *
 * Idempotente: la segunda corrida reporta 0 creados.
 *
 * OJO — el orden de arranque. La copia de verdad la hace la migración
 * `20260813175000_dj_catalogo_backfill`, porque el contenedor corre
 * `migrate:deploy` (las TRES migraciones) ANTES de cualquier backfill, y el
 * `DROP COLUMN "djHoraExtra"` de la fase 2 no puede esperar a un script de
 * TypeScript. Este script es la red: sirve para correrlo a mano, y sobre una
 * base ya migrada es un no-op que reporta ceros.
 *
 * Por eso `EventType.djHoraExtra` se lee con `$queryRaw` y detrás de un chequeo
 * de existencia: el cliente de Prisma con el que compila el repo es el de
 * DESPUÉS de la fase 2, donde esa columna ya no existe.
 */
async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ${tabla} AND column_name = ${columna}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function main(): Promise<void> {
  if (!(await existeColumna('EventType', 'djHoraExtra'))) {
    // La fase 2 ya cayó: la única fuente posible es la tabla nueva, y copiarla
    // sobre sí misma no tiene sentido. Se reporta lo que hay y se sale.
    const [renglones, catalogos] = await Promise.all([
      prisma.djHoraExtraPrice.count(),
      prisma.priceList.count(),
    ]);
    console.log(
      `· EventType."djHoraExtra" ya no existe (fase 2 aplicada): 0 creados. ` +
        `Hay ${renglones} renglones de DJ en ${catalogos} catálogos.`,
    );
    return;
  }

  const origen = await prisma.$queryRaw<{ id: string; nombre: string; djHoraExtra: number }[]>`
    SELECT "id", "nombre", "djHoraExtra" FROM "EventType"
     WHERE "djHoraExtra" IS NOT NULL ORDER BY "nombre"`;
  const catalogos = await prisma.priceList.findMany({ orderBy: [{ anio: 'asc' }, { nombre: 'asc' }] });

  if (origen.length === 0) {
    console.log('· Ningún tipo de evento tiene precio de DJ: nada que copiar.');
  }

  let creados = 0;
  for (const cat of catalogos) {
    // `skipDuplicates` sobre el @@unique(priceListId, eventTypeId) es lo que hace
    // idempotente al script: la segunda corrida no pisa un precio ya editado a
    // mano en el catálogo, que sería otro represiado.
    const { count } = await prisma.djHoraExtraPrice.createMany({
      data: origen.map((et) => ({
        priceListId: cat.id,
        eventTypeId: et.id,
        price: et.djHoraExtra,
      })),
      skipDuplicates: true,
    });
    creados += count;
    console.log(`· Catálogo ${cat.nombre}: ${count} renglones de DJ creados`);
  }

  const total = await prisma.djHoraExtraPrice.count();
  console.log(
    `\nListo. ${creados} renglones creados en esta corrida; ` +
      `${total} en total sobre ${catalogos.length} catálogos ` +
      `(${origen.length} tipos de evento con DJ: ${origen.map((e) => e.nombre).join(', ')}).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('backfill-fase14 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
