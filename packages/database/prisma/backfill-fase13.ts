import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Funde las dos PriceList de 2027 (dia + plano) en UN catálogo, le copia los
 * parámetros del singleton PricingConfig, y casa a él los servicios, los
 * paquetes de alimentos y todas las cotizaciones existentes.
 *
 * También borra el espacio vestigial "La Capilla": el negocio la trata como
 * casilla con tarifa de sábado (PriceList.capillaSabado), no como salón
 * rentable. Si alguna cotización la referencia, NO la borra y avisa — perder el
 * nombre de un espacio ya cotizado haría que el contrato imprima un cuid.
 *
 * Idempotente: la segunda corrida reporta 0 en todos los contadores.
 *
 * OJO — el orden de arranque. La fusión de verdad la hace la migración
 * `20260811125000_catalogo_backfill`, porque el contenedor corre
 * `migrate:deploy` (las DOS migraciones) ANTES de cualquier backfill, y el
 * `SET NOT NULL` de la fase 2 no puede esperar a un script de TypeScript. Este
 * script es la red: sirve para correrlo a mano, y sobre una base ya migrada es
 * un no-op que reporta ceros.
 *
 * Por eso `PriceList.tipo` y `PricingConfig` se leen con `$queryRaw` y detrás de
 * un chequeo de existencia: el cliente de Prisma con el que compila el repo es
 * el de DESPUÉS de la fase 2, donde ninguno de los dos existe ya.
 */
async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ${tabla} AND column_name = ${columna}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function existeTabla(tabla: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = ${tabla}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** El catálogo canónico: la lista 'dia' más reciente, o la activa si `tipo` ya murió. */
async function buscarCanon(hayTipo: boolean): Promise<{ id: string; anio: number; nombre: string | null }> {
  if (hayTipo) {
    const [canon] = await prisma.$queryRaw<{ id: string; anio: number; nombre: string | null }[]>`
      SELECT "id", "anio", "nombre" FROM "PriceList" WHERE "tipo" = 'dia' ORDER BY "anio" DESC LIMIT 1`;
    if (!canon) throw new Error('No hay ninguna PriceList tipo "dia" que promover a catálogo');
    return canon;
  }
  const canon =
    (await prisma.priceList.findFirst({ where: { activa: true }, orderBy: { anio: 'desc' } })) ??
    (await prisma.priceList.findFirst({ orderBy: { anio: 'desc' } }));
  if (!canon) throw new Error('No hay ninguna PriceList que promover a catálogo');
  return { id: canon.id, anio: canon.anio, nombre: canon.nombre };
}

async function main(): Promise<void> {
  const hayTipo = await existeColumna('PriceList', 'tipo');
  const hayConfig = await existeTabla('PricingConfig');

  // 1. El catálogo canónico se nombra, se activa y absorbe los parámetros.
  const canon = await buscarCanon(hayTipo);
  const [cfg] = hayConfig
    ? await prisma.$queryRaw<
        { ivaRate: number; extraHourRate: number; foodDiscountRate: number; capillaSabado: number }[]
      >`SELECT "ivaRate", "extraHourRate", "foodDiscountRate", "capillaSabado"
          FROM "PricingConfig" WHERE "id" = 'default'`
    : [undefined];

  await prisma.priceList.update({
    where: { id: canon.id },
    data: {
      nombre: canon.nombre ?? String(canon.anio),
      activa: true,
      // Sin PricingConfig (ya cayó en la fase 2) se dejan los valores que el
      // catálogo ya tiene: pisarlos con los defaults del esquema sería un
      // represiado silencioso de todo lo cotizado.
      ...(cfg
        ? {
            ivaRate: cfg.ivaRate,
            extraHourRate: cfg.extraHourRate,
            foodDiscountRate: cfg.foodDiscountRate,
            capillaSabado: cfg.capillaSabado,
          }
        : {}),
    },
  });
  console.log(`· Catálogo canónico: ${canon.nombre ?? canon.anio} (${canon.id})`);

  // 2. Mover los renglones de las listas 'plano' al catálogo, marcándolos.
  const planas = hayTipo
    ? await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PriceList" WHERE "tipo" = 'plano'`
    : [];
  for (const p of planas) {
    if (p.id === canon.id) continue;
    const { count } = await prisma.rentalPrice.updateMany({
      where: { priceListId: p.id },
      data: { priceListId: canon.id, tipo: 'plano' },
    });
    console.log(`· ${count} renglones de renta plana movidos desde ${p.id}`);
    await prisma.priceList.delete({ where: { id: p.id } });
  }

  // 3. Cualquier otro catálogo (años anteriores) se queda como está, solo se
  //    asegura que no esté activo: el activo es uno y solo uno.
  const { count: desactivados } = await prisma.priceList.updateMany({
    where: { id: { not: canon.id }, activa: true },
    data: { activa: false },
  });
  console.log(`· ${desactivados} catálogos secundarios desactivados`);

  // 4. Casar servicios, paquetes y cotizaciones huérfanos al catálogo.
  const servicios = await prisma.addOn.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } });
  const paquetes = await prisma.foodPackage.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } });
  const cotizaciones = await prisma.quote.updateMany({ where: { priceListId: null }, data: { priceListId: canon.id } });
  console.log(`· ${servicios.count} servicios casados al catálogo`);
  console.log(`· ${paquetes.count} paquetes casados al catálogo`);
  console.log(`· ${cotizaciones.count} cotizaciones casadas al catálogo`);

  // 5. La Capilla vestigial.
  const capilla = await prisma.space.findFirst({ where: { nombre: { contains: 'apilla' } } });
  if (!capilla) {
    console.log('· No hay espacio "La Capilla" que limpiar.');
  } else {
    const enUso = await prisma.quote.count({ where: { spaceIds: { has: capilla.id } } });
    if (enUso > 0) {
      console.warn(
        `· ATENCIÓN: "La Capilla" (${capilla.id}) la referencian ${enUso} cotizaciones. NO se borra.`,
      );
    } else {
      await prisma.rentalPrice.deleteMany({ where: { spaceId: capilla.id } });
      await prisma.spacePaymentRule.deleteMany({ where: { spaceId: capilla.id } });
      await prisma.space.delete({ where: { id: capilla.id } });
      console.log('· Espacio vestigial "La Capilla" borrado (es casilla, no salón rentable).');
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('backfill-fase13 falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
