import type { PrismaClient } from '@hsa/database';
import { ownershipWhere, type Actor } from './service.js';
import { apartadoVivo } from '../banqueteros/apartados.js';

/**
 * Estatus que ocupan la fecha de verdad. Debe seguir a `BLOQUEO` de
 * `../availability/service.ts`: si allá cambia qué bloquea, aquí también.
 */
const BLOQUEANTES = ['formalizada', 'complementada', 'liquidada'] as const;
/**
 * Estatus que todavía esperan respuesta y por lo tanto pueden quedar desplazados.
 *
 * Solo queda `borrador` desde que se retiraron `enviada` y `aceptada` (punto 8).
 * Y sin `vencida`, un borrador viejo sigue avisando: es la consecuencia que el
 * dueño aceptó al eliminar el vencimiento automático.
 */
const VIVAS = ['borrador'] as const;

export interface Desplazada {
  id: string;
  clienteNombre: string;
  fechaEvento: Date;
  spaceIds: string[];
  /**
   * Quién ocupa la fecha: otro evento comprometido, o un APARTADO de banquetero.
   * El apartado bloquea igual que un evento (es dinero sobre la fecha) pero no es
   * una cotización: su `id` es el del apartado y su nombre, el del banquetero.
   */
  bloqueadaPor: { id: string; clienteNombre: string; tipo: 'evento' | 'apartado' };
}

/**
 * Cotizaciones vivas cuya fecha y espacio ya fueron apartados por otra.
 *
 * Derivado a propósito: no hay tabla de avisos que se pueda quedar obsoleta, y
 * el aviso desaparece solo cuando el vendedor mueve la fecha o cancela. Tampoco
 * se puede "descartar": mientras haya dos eventos comprometidos el mismo día en
 * el mismo espacio, el problema sigue existiendo.
 *
 * Un vendedor ve las suyas; un admin, todas. Las bloqueantes NO se filtran por
 * pertenencia: que la fecha la haya apartado otro vendedor es precisamente el
 * caso que hay que avisar.
 */
export async function cotizacionesDesplazadas(db: PrismaClient, actor: Actor): Promise<Desplazada[]> {
  const vivas = await db.quote.findMany({
    where: { status: { in: [...VIVAS] }, deletedAt: null, ...ownershipWhere(actor) },
    select: { id: true, fechaEvento: true, spaceIds: true, client: { select: { nombre: true } } },
    orderBy: { fechaEvento: 'asc' },
  });
  if (vivas.length === 0) return [];

  const fechas = [...new Set(vivas.map((v) => v.fechaEvento.getTime()))].map((t) => new Date(t));
  const [eventos, apartados] = await Promise.all([
    db.quote.findMany({
      where: { status: { in: [...BLOQUEANTES] }, deletedAt: null, fechaEvento: { in: fechas } },
      select: { id: true, fechaEvento: true, spaceIds: true, client: { select: { nombre: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    // Los apartados de banquetero también desplazan: bloquean la fecha igual que
    // un evento formalizado. Antes no se miraban, y un borrador cuya fecha se
    // apartó seguía viéndose libre para quien lo cotizó.
    db.apartadoFecha.findMany({
      where: { fechaEvento: { in: fechas }, quoteId: null, canceladoAt: null },
      select: {
        id: true,
        fechaEvento: true,
        spaceIds: true,
        canceladoAt: true,
        quoteId: true,
        vence: true,
        banquetero: { select: { nombre: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const bloqueantes = [
    ...eventos.map((e) => ({ ...e, nombre: e.client.nombre, tipo: 'evento' as const })),
    // Un apartado vencido ya soltó la fecha (se libera solo, sin que nadie lo toque).
    ...apartados.filter((a) => apartadoVivo(a)).map((a) => ({ ...a, nombre: a.banquetero.nombre, tipo: 'apartado' as const })),
  ];
  if (bloqueantes.length === 0) return [];

  const out: Desplazada[] = [];
  for (const v of vivas) {
    const choque = bloqueantes.find(
      (b) =>
        b.id !== v.id &&
        b.fechaEvento.getTime() === v.fechaEvento.getTime() &&
        b.spaceIds.some((s) => v.spaceIds.includes(s)),
    );
    if (!choque) continue;
    out.push({
      id: v.id,
      clienteNombre: v.client.nombre,
      fechaEvento: v.fechaEvento,
      spaceIds: v.spaceIds,
      bloqueadaPor: { id: choque.id, clienteNombre: choque.nombre, tipo: choque.tipo },
    });
  }
  return out;
}
