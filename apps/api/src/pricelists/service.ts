import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError } from '../quotes/service.js';
import { contratosQueUsan, mensajeEnUso } from '../quotes/usos.js';

export const clonarCatalogoSchema = z.object({
  nombre: z.string().min(1).max(60),
  anio: z.number().int().min(2000).max(2100),
  /** Catálogo del que se copia todo. Sin él nace un catálogo vacío. */
  clonarDe: z.string().optional(),
  /** Porcentaje de incremento sobre renta, servicios y alimentos. */
  incrementoPct: z.number().min(-100).max(1000).optional(),
});

/**
 * El porcentaje se aplica en UN solo lugar: renta, servicios y alimentos usan la
 * misma regla, y cuatro copias de la fórmula divergen a la primera corrección.
 *
 * `Math.round` no es cosmético. Las columnas de precio son enteros de pesos, y un
 * flotante NO llega nunca a Postgres: el query engine de Prisma lo TRUNCA antes
 * de mandarlo (5.5 → 5, 3.5 → 3; verificado con el log de queries — el parámetro
 * sale ya entero). Sin este `Math.round`, el catálogo nuevo saldría un peso abajo
 * en cada renglón con fracción, sin error ni aviso.
 *
 * Ojo con la confusión fácil: Postgres, cuando SÍ le toca castear un `float8` a
 * `int`, redondea a la mitad PAR (5.5 → 6, 3.5 → 4). Pero ese camino no existe
 * aquí, porque Prisma nunca le manda el flotante.
 */
const conIncremento = (v: number, pct: number): number => Math.round(v * (1 + pct / 100));

/**
 * Crea un catálogo nuevo, opcionalmente clonando otro con un % de incremento.
 *
 * Nace SIEMPRE inactivo: crear el catálogo del año que viene no debe cambiar el
 * precio de lo que se cotiza hoy. Activarlo es un acto aparte y explícito.
 *
 * Todo el copiado va en UNA transacción: un catálogo a medias —con renta pero
 * sin paquetes, o con paquetes sin brackets— es peor que ningún catálogo, porque
 * el motor lanza al cotizar y nadie sabe por qué.
 */
export async function clonarCatalogo(db: PrismaClient, rawInput: unknown) {
  const input = clonarCatalogoSchema.parse(rawInput);
  const pct = input.incrementoPct ?? 0;

  const origen = input.clonarDe
    ? await db.priceList.findUnique({ where: { id: input.clonarDe } })
    : null;
  if (input.clonarDe && !origen) {
    throw new QuoteError(404, `El catálogo ${input.clonarDe} no existe`);
  }

  const homonimo = await db.priceList.findUnique({ where: { nombre: input.nombre } });
  if (homonimo) {
    throw new QuoteError(409, `Ya existe un catálogo llamado "${input.nombre}"`);
  }

  return db.$transaction(async (tx) => {
    const creado = await tx.priceList.create({
      data: {
        nombre: input.nombre,
        anio: input.anio,
        activa: false,
        // Los parámetros viajan tal cual: el IVA y los porcentajes no son precios
        // y subirlos un 8% junto con la renta sería un error de $1,000s.
        ...(origen
          ? {
              ivaRate: origen.ivaRate,
              extraHourRate: origen.extraHourRate,
              foodDiscountRate: origen.foodDiscountRate,
              capillaSabado: origen.capillaSabado,
            }
          : {}),
      },
    });
    if (!origen) return creado;

    // Renta: se conserva `tipo`. Aplanar la renta plana a "dia" dejaría al Team
    // Building sin precio en el catálogo nuevo.
    const rentas = await tx.rentalPrice.findMany({ where: { priceListId: origen.id } });
    if (rentas.length > 0) {
      await tx.rentalPrice.createMany({
        data: rentas.map((r) => ({
          priceListId: creado.id,
          spaceId: r.spaceId,
          tipo: r.tipo,
          min: r.min,
          max: r.max,
          viernes: conIncremento(r.viernes, pct),
          viernesEspecial: conIncremento(r.viernesEspecial, pct),
          sabado: conIncremento(r.sabado, pct),
          domAJue: conIncremento(r.domAJue, pct),
        })),
      });
    }

    // Servicios: se conserva `activo`. El catálogo tiene que RESOLVER lo que ya
    // no OFRECE, porque las cotizaciones viejas siguen referenciándolo.
    const addOns = await tx.addOn.findMany({ where: { priceListId: origen.id } });
    if (addOns.length > 0) {
      await tx.addOn.createMany({
        data: addOns.map((a) => ({
          priceListId: creado.id,
          nombre: a.nombre,
          kind: a.kind,
          price: conIncremento(a.price, pct),
          activo: a.activo,
        })),
      });
    }

    // DJ por hora extra: un renglón por tipo de evento. Los tipos SIN renglón
    // (no ofrecen el servicio) siguen sin renglón en el clon: darles uno haría
    // que un bautizo empezara a cobrar DJ solo por clonar el año.
    const djPrices = await tx.djHoraExtraPrice.findMany({ where: { priceListId: origen.id } });
    if (djPrices.length > 0) {
      await tx.djHoraExtraPrice.createMany({
        data: djPrices.map((d) => ({
          priceListId: creado.id,
          eventTypeId: d.eventTypeId,
          price: conIncremento(d.price, pct),
        })),
      });
    }

    // Alimentos: el paquete no vale nada sin sus brackets —ahí está el precio por
    // persona—, así que viajan juntos en el mismo `create` anidado.
    const paquetes = await tx.foodPackage.findMany({
      where: { priceListId: origen.id },
      include: { brackets: true },
    });
    for (const p of paquetes) {
      await tx.foodPackage.create({
        data: {
          priceListId: creado.id,
          eventTypeId: p.eventTypeId,
          nombre: p.nombre,
          ivaIncluido: p.ivaIncluido,
          incluye: p.incluye,
          brackets: {
            create: p.brackets.map((b) => ({
              min: b.min,
              max: b.max,
              pricePerPerson: conIncremento(b.pricePerPerson, pct),
            })),
          },
        },
      });
    }

    return creado;
  });
}

/**
 * Deja UN solo catálogo activo. Solo afecta a las cotizaciones NUEVAS: las que
 * ya existen quedaron casadas a su catálogo al crearse y no se represian.
 */
export async function activarCatalogo(db: PrismaClient, id: string) {
  const existe = await db.priceList.findUnique({ where: { id }, select: { id: true } });
  if (!existe) throw new QuoteError(404, `El catálogo ${id} no existe`);

  const [, activado] = await db.$transaction([
    db.priceList.updateMany({ data: { activa: false } }),
    db.priceList.update({ where: { id }, data: { activa: true } }),
  ]);
  return activado;
}

/**
 * Borra un catálogo completo, con su contenido.
 *
 * Existe porque un catálogo creado por error no se podía quitar: quedaba en la
 * lista para siempre, y lo único que se podía hacer era editarlo.
 *
 * Se lleva lo que le PERTENECE —renta, servicios, paquetes con sus rangos, DJ y
 * su propia bitácora de cambios— y se niega si algo de AFUERA lo necesita. La
 * diferencia importa: su contenido no significa nada sin él, mientras que una
 * cotización casada a este catálogo recalcula contra sus precios y sin ellos se
 * queda sin poder reeditarse.
 *
 * El acto de borrarlo sí queda registrado: la bitácora forense lo escribe con
 * disparadores de la base, así que el rastro sobrevive aunque la bitácora del
 * catálogo se vaya con él.
 */
export async function borrarCatalogo(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    const cat = await tx.priceList.findUnique({
      where: { id },
      select: { id: true, nombre: true, anio: true, activa: true },
    });
    if (!cat) throw new QuoteError(404, `El catálogo ${id} no existe`);

    // 1. El activo, no. Sin catálogo activo no se puede cotizar nada, y el
    //    borrado dejaría la aplicación sin poder crear un solo contrato.
    if (cat.activa) {
      throw new QuoteError(
        409,
        'No se puede borrar el catálogo activo. Activa otro y vuelve a intentarlo.',
      );
    }

    // 2. Las cotizaciones lo bloquean, y el mensaje dice CUÁLES.
    //
    //    Se busca por dos caminos: las casadas al catálogo y las que apuntan a
    //    uno de sus paquetes de alimentos. `Quote.foodPackageId` es una columna
    //    suelta y no una llave foránea, así que nada en la base impediría
    //    dejarla apuntando al vacío; el segundo camino no debería encontrar
    //    nada que el primero no traiga, y está por si acaso.
    const paquetes = await tx.foodPackage.findMany({
      where: { priceListId: id },
      select: { id: true },
    });
    const uso = await contratosQueUsan(tx, {
      OR: [
        { priceListId: id },
        ...(paquetes.length > 0 ? [{ foodPackageId: { in: paquetes.map((f) => f.id) } }] : []),
      ],
    });
    if (uso.total > 0) {
      throw new QuoteError(409, mensajeEnUso(uso, false), { enUso: uso });
    }

    // 3. Y las fechas apartadas con precio garantizado. Un banquetero negoció
    //    2029 contra ESTOS precios; borrarlos le quitaría lo que se le prometió.
    const apartados = await tx.apartadoFecha.findMany({
      where: { priceListId: id, canceladoAt: null },
      orderBy: { fechaEvento: 'asc' },
      take: 5,
      select: {
        fechaEvento: true,
        banquetero: { select: { nombre: true } },
      },
    });
    if (apartados.length > 0) {
      const lista = apartados
        .map(
          (a) =>
            `${a.banquetero?.nombre ?? 'Banquetero'} (${a.fechaEvento.toISOString().slice(0, 10)})`,
        )
        .join(', ');
      throw new QuoteError(
        409,
        `No se puede borrar: hay ${apartados.length} fecha(s) apartada(s) con este catálogo como precio garantizado — ${lista}.`,
      );
    }

    // De hijos a padres. `FoodPackagePrice` no borra en cascada, así que sus
    // rangos se van primero o la transacción truena en la llave foránea.
    if (paquetes.length > 0) {
      await tx.foodPackagePrice.deleteMany({
        where: { packageId: { in: paquetes.map((f) => f.id) } },
      });
    }
    await tx.foodPackage.deleteMany({ where: { priceListId: id } });
    await tx.rentalPrice.deleteMany({ where: { priceListId: id } });
    await tx.djHoraExtraPrice.deleteMany({ where: { priceListId: id } });
    await tx.addOn.deleteMany({ where: { priceListId: id } });
    await tx.priceListAudit.deleteMany({ where: { priceListId: id } });
    await tx.priceList.delete({ where: { id } });

    return { borrado: id, nombre: cat.nombre, anio: cat.anio };
  });
}

/**
 * Los catálogos con cuánto contiene cada uno y cuántas cotizaciones lo usan.
 * El conteo de cotizaciones es lo que dice si un catálogo se puede tocar.
 */
export async function listarCatalogos(db: PrismaClient) {
  const items = await db.priceList.findMany({
    orderBy: [{ anio: 'desc' }, { nombre: 'desc' }],
    include: {
      _count: { select: { quotes: true, rentalPrices: true, addOns: true, foodPackages: true } },
      // El precio del DJ va con nombre del tipo de evento: la pantalla lo
      // muestra por renglón, y un cuid no le dice nada a nadie.
      djPrices: {
        include: { eventType: { select: { nombre: true } } },
        orderBy: { eventType: { nombre: 'asc' } },
      },
    },
  });
  return items.map(({ _count, djPrices, ...priceList }) => ({
    ...priceList,
    cotizaciones: _count.quotes,
    renta: _count.rentalPrices,
    servicios: _count.addOns,
    paquetes: _count.foodPackages,
    dj: djPrices.map((d) => ({
      eventTypeId: d.eventTypeId,
      eventType: d.eventType.nombre,
      price: d.price,
    })),
  }));
}
