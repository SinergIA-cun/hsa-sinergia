import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { QuoteError } from '../quotes/service.js';

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
