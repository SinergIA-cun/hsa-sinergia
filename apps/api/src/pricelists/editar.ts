import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
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
    const existe = await tx.priceList.findUnique({ where: { id: priceListId }, select: { id: true } });
    if (!existe) throw new QuoteError(404, `El catálogo ${priceListId} no existe`);

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
