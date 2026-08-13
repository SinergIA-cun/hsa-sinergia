import { z } from 'zod';
import type { Prisma, PrismaClient } from '@hsa/database';
import { QuoteError, type Actor } from '../quotes/service.js';
import { registrarCambioCatalogo } from './audit.js';

/**
 * Un precio en pesos.
 *
 * `int()` no es cosmético: Prisma NO rechaza un flotante en una columna `Int`, lo
 * manda a Postgres, y Postgres **trunca** sin error ni aviso (5.5 → 5,
 * 3165.5 → 3165). Un precio con centavos entraría como un precio un peso abajo.
 */
const precio = z.number().int().nonnegative();

/**
 * Ningún precio entra a la base sin pasar por aquí, aunque Zod ya haya exigido
 * `int()`. Es la última red antes de Postgres, que trunca en silencio.
 */
const aPesos = (n: number): number => Math.round(n);

/** Existe el catálogo, o 404. Se hace dentro de la transacción del cambio. */
async function assertCatalogo(tx: Prisma.TransactionClient, priceListId: string): Promise<void> {
  const existe = await tx.priceList.findUnique({ where: { id: priceListId }, select: { id: true } });
  if (!existe) throw new QuoteError(404, `El catálogo ${priceListId} no existe`);
}

/** Los cuatro precios de un renglón. NO se toca `min`/`max`: ver `editarRentas`. */
const rentaCambioSchema = z.object({
  id: z.string().min(1),
  viernes: precio,
  viernesEspecial: precio,
  sabado: precio,
  domAJue: precio,
});

export const editarRentasSchema = z.object({
  cambios: z.array(rentaCambioSchema).min(1),
});

const CAMPOS_RENTA = ['viernes', 'viernesEspecial', 'sabado', 'domAJue'] as const;

/**
 * Actualiza los precios de renglones de renta de UN catálogo.
 *
 * Solo precios. Los rangos de invitados (`min`/`max`) no se pueden agregar,
 * quitar ni mover: un hueco entre rangos hace que el motor lance "no tiene rango
 * de renta para N invitados" la primera vez que alguien capture ese número, meses
 * después. Esa puerta se queda cerrada por decisión del dueño.
 *
 * Editar los precios NO reescribe ninguna cotización: los `total` y `breakdown`
 * guardados quedan congelados. El represiado solo ocurre si alguien REEDITA la
 * cotización después, y de eso avisa la bitácora.
 *
 * Todo va en UNA transacción con su renglón de bitácora: media edición aplicada
 * sin rastro es exactamente lo que este tramo no puede permitirse.
 */
export async function editarRentas(
  db: PrismaClient,
  priceListId: string,
  rawInput: unknown,
  actor: Actor | null,
) {
  const { cambios } = editarRentasSchema.parse(rawInput);

  const repetidos = cambios.length !== new Set(cambios.map((c) => c.id)).size;
  if (repetidos) throw new QuoteError(400, 'Un mismo renglón de renta viene dos veces');

  return db.$transaction(async (tx) => {
    await assertCatalogo(tx, priceListId);

    const actuales = await tx.rentalPrice.findMany({
      where: { id: { in: cambios.map((c) => c.id) } },
      include: { space: { select: { nombre: true } } },
    });
    const porId = new Map(actuales.map((r) => [r.id, r]));

    // Cada id tiene que ser DE ESTE catálogo. Sin esta guarda, un id de otro año
    // editaría precios de otro catálogo desde la pantalla equivocada.
    for (const c of cambios) {
      const actual = porId.get(c.id);
      if (!actual || actual.priceListId !== priceListId) {
        throw new QuoteError(400, `El renglón de renta ${c.id} no pertenece a este catálogo`);
      }
    }

    const renglones = [];
    for (const c of cambios) {
      const actual = porId.get(c.id)!;
      const despues = {
        viernes: aPesos(c.viernes),
        viernesEspecial: aPesos(c.viernesEspecial),
        sabado: aPesos(c.sabado),
        domAJue: aPesos(c.domAJue),
      };
      await tx.rentalPrice.update({ where: { id: c.id }, data: despues });
      renglones.push({
        id: c.id,
        espacio: actual.space.nombre,
        rango: `${actual.min}–${actual.max ?? '∞'}`,
        tipo: actual.tipo,
        antes: Object.fromEntries(CAMPOS_RENTA.map((k) => [k, actual[k]])),
        despues,
      });
    }

    const resumen = renglones
      .map((r) => `${r.espacio} ${r.rango}`)
      .join(', ');
    await registrarCambioCatalogo(
      tx,
      {
        priceListId,
        tipo: 'renta',
        descripcion: `Renta: ${renglones.length} renglón(es) actualizados — ${resumen}`,
        meta: { renglones },
      },
      actor,
    );

    return { actualizados: renglones.length, renglones };
  });
}

// --- Servicios (add-ons) ---
//
// A diferencia de la renta, aquí SÍ se agrega y se quita: es el caso del
// banquetero que cambia, o del servicio que se deja de ofrecer.

const KINDS = ['fijo', 'porPersona', 'porUnidad'] as const;

export const servicioCreateSchema = z.object({
  nombre: z.string().min(1).max(80),
  kind: z.enum(KINDS),
  price: precio,
  activo: z.boolean().default(true),
});

export const servicioUpdateSchema = z
  .object({
    nombre: z.string().min(1).max(80).optional(),
    kind: z.enum(KINDS).optional(),
    price: precio.optional(),
    activo: z.boolean().optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: 'No hay nada que cambiar',
  });

/**
 * El servicio existe y es DE ESTE catálogo, o 400. Sin esta guarda, el id de un
 * servicio de 2027 se editaría desde la pantalla de 2028.
 */
async function servicioDelCatalogo(
  tx: Prisma.TransactionClient,
  priceListId: string,
  addOnId: string,
) {
  const addOn = await tx.addOn.findUnique({ where: { id: addOnId } });
  if (!addOn || addOn.priceListId !== priceListId) {
    throw new QuoteError(400, `El servicio ${addOnId} no pertenece a este catálogo`);
  }
  return addOn;
}

export async function crearServicio(
  db: PrismaClient,
  priceListId: string,
  rawInput: unknown,
  actor: Actor | null,
) {
  const input = servicioCreateSchema.parse(rawInput);
  return db.$transaction(async (tx) => {
    await assertCatalogo(tx, priceListId);
    const addOn = await tx.addOn.create({
      data: { ...input, price: aPesos(input.price), priceListId },
    });
    await registrarCambioCatalogo(
      tx,
      {
        priceListId,
        tipo: 'servicio',
        descripcion: `Servicio "${addOn.nombre}" agregado (${addOn.price} · ${addOn.kind})`,
        meta: { accion: 'alta', addOnId: addOn.id, despues: { nombre: addOn.nombre, kind: addOn.kind, price: addOn.price, activo: addOn.activo } },
      },
      actor,
    );
    return addOn;
  });
}

/**
 * Edita nombre, precio, tipo de cobro o la bandera `activo`.
 *
 * Desactivar NO lo saca del catálogo: lo saca del SELECTOR. El catálogo tiene que
 * seguir resolviéndolo, porque las cotizaciones que ya lo traen lo referencian
 * por id y el motor lanza si no lo encuentra. Es la lección del valet: darlo de
 * baja dejó cotizaciones irrecalculables.
 */
export async function editarServicio(
  db: PrismaClient,
  priceListId: string,
  addOnId: string,
  rawInput: unknown,
  actor: Actor | null,
) {
  const input = servicioUpdateSchema.parse(rawInput);
  return db.$transaction(async (tx) => {
    await assertCatalogo(tx, priceListId);
    const antes = await servicioDelCatalogo(tx, priceListId, addOnId);
    const addOn = await tx.addOn.update({
      where: { id: addOnId },
      data: { ...input, ...(input.price === undefined ? {} : { price: aPesos(input.price) }) },
    });
    await registrarCambioCatalogo(
      tx,
      {
        priceListId,
        tipo: 'servicio',
        descripcion: `Servicio "${antes.nombre}" editado: ${Object.keys(input).join(', ')}`,
        meta: {
          accion: 'edicion',
          addOnId,
          antes: { nombre: antes.nombre, kind: antes.kind, price: antes.price, activo: antes.activo },
          despues: { nombre: addOn.nombre, kind: addOn.kind, price: addOn.price, activo: addOn.activo },
        },
      },
      actor,
    );
    return addOn;
  });
}

/**
 * Borra un servicio del catálogo, solo si NINGUNA cotización de ese catálogo lo
 * referencia.
 *
 * Se cuentan también las cotizaciones en la papelera: una cotización borrada se
 * puede restaurar, y restaurarla con un add-on que ya no existe la deja
 * irrecalculable. Para eso está `activo: false`, que es la salida correcta.
 */
export async function borrarServicio(
  db: PrismaClient,
  priceListId: string,
  addOnId: string,
  actor: Actor | null,
) {
  return db.$transaction(async (tx) => {
    await assertCatalogo(tx, priceListId);
    const addOn = await servicioDelCatalogo(tx, priceListId, addOnId);

    // `addOns` es JSON, no una relación: el uso se cuenta con un contains de jsonb.
    const rows = await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM "Quote"
      WHERE "priceListId" = ${priceListId}
        AND "addOns" @> ${JSON.stringify([{ addOnId }])}::jsonb`;
    const n = rows[0]?.count ?? 0;
    if (n > 0) {
      throw new QuoteError(
        409,
        `No se puede borrar: en uso por ${n} cotización(es) de este catálogo. Desactívalo en vez de borrarlo.`,
      );
    }

    await tx.addOn.delete({ where: { id: addOnId } });
    await registrarCambioCatalogo(
      tx,
      {
        priceListId,
        tipo: 'servicio',
        descripcion: `Servicio "${addOn.nombre}" eliminado`,
        meta: {
          accion: 'baja',
          addOnId,
          antes: { nombre: addOn.nombre, kind: addOn.kind, price: addOn.price, activo: addOn.activo },
        },
      },
      actor,
    );
    return { borrado: addOnId };
  });
}
