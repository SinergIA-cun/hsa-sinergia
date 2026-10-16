import type { PrismaClient } from '@hsa/database';
import { hoyCivilMexico, pesosTexto } from '@hsa/shared';
import { QuoteError, loadEstadoCuentaBulk, type Actor } from '../quotes/service.js';
import { cuentaBanquete } from '../payments/banquete.js';
import { cuentaDelEvento } from '../cargos/cuenta.js';

/**
 * Descuadres entre lo contratado y lo cobrado (reunión del 15-oct-2026: "configurar
 * auditorías cuando cobrado ≠ valor de contrato"). Solo para el admin.
 *
 * Qué cuenta como descuadre:
 *  - Un evento que YA PASÓ con saldo en cualquiera de sus tres cuentas (renta,
 *    banquete, punto de venta): se dio el evento y algo no se cobró.
 *  - Cualquier evento, pasado o futuro, con saldo NEGATIVO: se cobró de más.
 *  - Un estatus que no dice lo que dicen los pagos: liquidado con saldo, o ya
 *    pasado, cobrado completo y sin marcar liquidado.
 *
 * No entran los borradores, los cancelados (se cuadran con sus devoluciones),
 * los que están en standby ni los CERRADOS (ya se conciliaron).
 */

export interface Descuadre {
  quoteId: string;
  codigo: string | null;
  cliente: string;
  fecha: string;
  status: string;
  pasado: boolean;
  renta: { total: number; pagado: number; saldo: number };
  banquete: { total: number; pagado: number; saldo: number } | null;
  puntoDeVenta: { total: number; pagado: number; saldo: number } | null;
  motivos: string[];
}

export async function descuadres(db: PrismaClient, actor: Actor, hoy = hoyCivilMexico()): Promise<Descuadre[]> {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo el admin ve los descuadres.');
  const quotes = await db.quote.findMany({
    where: {
      deletedAt: null,
      cerradoAt: null,
      status: { in: ['formalizada', 'complementada', 'liquidada'] },
    },
    select: {
      id: true,
      etiqueta: true,
      status: true,
      fechaEvento: true,
      spaceIds: true,
      breakdown: true,
      total: true,
      rentaTotal: true,
      client: { select: { nombre: true } },
    },
    orderBy: { fechaEvento: 'desc' },
  });
  const cuentas = await loadEstadoCuentaBulk(db, quotes);

  const out: Descuadre[] = [];
  for (const q of quotes) {
    const ec = cuentas.get(q.id);
    if (!ec) continue;
    const pasado = q.fechaEvento < hoy;
    const [banq, pos] = await Promise.all([cuentaBanquete(db, q), cuentaDelEvento(db, q.id)]);
    const motivos: string[] = [];

    if (ec.saldo < 0) motivos.push(`Renta cobrada de más: ${pesosTexto(-ec.saldo)}`);
    else if (pasado && ec.saldo > 0) motivos.push(`Renta sin cobrar: ${pesosTexto(ec.saldo)}`);
    if (banq.total > 0 || banq.pagado > 0) {
      if (banq.saldo < 0) motivos.push(`Banquete cobrado de más: ${pesosTexto(-banq.saldo)}`);
      else if (pasado && banq.saldo > 0 && banq.pagado > 0) motivos.push(`Banquete sin cobrar: ${pesosTexto(banq.saldo)}`);
    }
    if (pos.saldo < 0) motivos.push(`Punto de venta cobrado de más: ${pesosTexto(-pos.saldo)}`);
    else if (pasado && pos.saldo > 0) motivos.push(`Punto de venta sin cobrar: ${pesosTexto(pos.saldo)}`);
    if (q.status === 'liquidada' && ec.saldo > 0) motivos.push('Marcado liquidado con saldo en la renta');
    if (pasado && ec.saldo === 0 && q.status !== 'liquidada') motivos.push('Cobrado completo pero no está marcado liquidado');

    if (motivos.length === 0) continue;
    out.push({
      quoteId: q.id,
      codigo: q.etiqueta,
      cliente: q.client?.nombre ?? 'Cliente',
      fecha: q.fechaEvento.toISOString().slice(0, 10),
      status: q.status,
      pasado,
      renta: { total: ec.total, pagado: ec.pagado, saldo: ec.saldo },
      banquete: banq.total > 0 || banq.pagado > 0 ? { total: banq.total, pagado: banq.pagado, saldo: banq.saldo } : null,
      puntoDeVenta: pos.total > 0 || pos.pagado > 0 ? { total: pos.total, pagado: pos.pagado, saldo: pos.saldo } : null,
      motivos,
    });
  }
  return out;
}
