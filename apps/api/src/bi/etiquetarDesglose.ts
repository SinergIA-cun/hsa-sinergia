import type { Prisma, PrismaClient } from '@hsa/database';
import { computeQuote, type Catalog, type LineaRef, type QuoteLine } from '@hsa/shared';
import { loadCatalog } from '../catalog/loader.js';
import { SELECCION_INCLUDE, seleccionGuardada, toSelection } from '../quotes/service.js';

/**
 * Le pone `ref` (qué es cada renglón, en datos) a los desgloses guardados antes
 * de que el motor lo hiciera (6-oct-2026), para que su `desglose[]` del BI salga
 * con claves y cantidades y no como `otro`.
 *
 * No cambia ningún monto. Recalcula con el motor solo para saber QUÉ es cada
 * renglón: se empareja por salón (`spaceId`) y por concepto, y el precio
 * unitario sale del monto GUARDADO (el catálogo pudo cambiar desde entonces). Si
 * algún renglón no se empareja, el evento se deja como está.
 *
 * Idempotente: solo toca desgloses con renglones sin `ref`.
 */
export async function etiquetarDesgloses(db: PrismaClient): Promise<{ etiquetados: number; sinEmparejar: string[] }> {
  // Son cientos, no miles: se leen todos y se salta lo que ya tiene `ref`.
  const quotes = await db.quote.findMany({ include: SELECCION_INCLUDE });
  const catalogos = new Map<string, Catalog>();
  const catalogo = async (id: string) => {
    if (!catalogos.has(id)) catalogos.set(id, await loadCatalog(db, { priceListId: id }));
    return catalogos.get(id)!;
  };
  let etiquetados = 0;
  const sinEmparejar: string[] = [];
  for (const q of quotes) {
    const lines = ((q.breakdown as { lines?: QuoteLine[] } | null)?.lines ?? []) as QuoteLine[];
    if (lines.length === 0 || lines.every((l) => l.ref)) continue;
    const refs = await refsPara(db, q, lines, catalogo);
    if (!refs) {
      sinEmparejar.push(q.etiqueta ?? q.id);
      continue;
    }
    await db.quote.update({
      where: { id: q.id },
      data: {
        breakdown: { ...(q.breakdown as object), lines: lines.map((l, i) => ({ ...l, ref: l.ref ?? refs[i] })) } as unknown as Prisma.InputJsonValue,
      },
    });
    etiquetados++;
  }
  return { etiquetados, sinEmparejar };
}

type QuoteConSeleccion = Prisma.QuoteGetPayload<{ include: typeof SELECCION_INCLUDE }>;

/** El `ref` de cada renglón, o `null` si alguno no se pudo emparejar. */
async function refsPara(
  db: PrismaClient,
  q: QuoteConSeleccion,
  lines: QuoteLine[],
  catalogo: (id: string) => Promise<Catalog>,
): Promise<(LineaRef | undefined)[] | null> {
  const cargos = new Map(
    (await db.cargoEvento.findMany({ where: { quoteId: q.id }, select: { id: true, producto: true, cantidad: true, precioUnitario: true } })).map(
      (c) => [c.id, c],
    ),
  );

  // Lo que el motor diría hoy de la misma selección. Un evento importado (precio
  // pactado) no tiene selección que describa lo vendido: no se recalcula.
  let calculadas: QuoteLine[] = [];
  if (!q.precioPactado || lines.some((l) => !esPactado(l) && !l.cargoId)) {
    try {
      calculadas = computeQuote(await catalogo(q.priceListId), toSelection(seleccionGuardada(q))).lines;
    } catch {
      calculadas = [];
    }
  }
  const usadas = new Set<number>();
  const refs: (LineaRef | undefined)[] = [];
  for (const l of lines) {
    if (l.ref) {
      refs.push(undefined);
      continue;
    }
    if (l.cargoId) {
      const c = cargos.get(l.cargoId);
      if (!c) return null;
      refs.push({ tipo: 'cargoContrato', id: c.producto, cantidad: c.cantidad, unidad: c.producto === 'horaExtra' ? 'horas' : 'personas', precioUnitario: c.precioUnitario });
      continue;
    }
    if (esPactado(l)) {
      refs.push(
        l.grupo === 'otros'
          ? { tipo: 'pactado', cantidad: 1, unidad: 'evento', precioUnitario: l.monto }
          : { tipo: 'rentaSalon', ...(l.spaceId ? { id: l.spaceId } : {}), cantidad: 1, unidad: 'evento', precioUnitario: l.monto },
      );
      continue;
    }
    const k = calculadas.findIndex(
      (c, i) => !usadas.has(i) && c.grupo === l.grupo && (l.spaceId ? c.spaceId === l.spaceId : c.concepto === l.concepto),
    );
    if (k < 0 || !calculadas[k]!.ref) return null;
    usadas.add(k);
    const ref = calculadas[k]!.ref!;
    // El precio es el que se guardó, no el de hoy.
    refs.push({ ...ref, precioUnitario: ref.cantidad > 0 ? Math.round((l.monto / ref.cantidad) * 100) / 100 : l.monto });
  }
  return refs;
}

/** Un renglón armado con el precio pactado del BI (importación o renta acordada). */
const esPactado = (l: QuoteLine) => /Precio pactado|Renta acordada/.test(l.detalle ?? '');
