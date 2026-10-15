import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import { conPaquetePactado, montoNoNegativoSchema, pesosTexto, type QuoteBreakdown } from '@hsa/shared';
import { logActivity } from '../quotes/activityLog.js';

/**
 * El paquete de alimentos de los eventos importados (BI #4, 15-oct-2026).
 *
 * Los eventos que llegaron del libro del BI traen "alimentos y servicios" como
 * un monto único pactado. El BI manda qué paquete de nuestro catálogo fue
 * (`clave`) y, en los pocos que la traen, la comisión de la agencia como monto.
 * Se guardan en el renglón `pactado` sin mover el monto: sigue sin ser precio
 * por persona.
 *
 * La agencia NO viene en el lote: la hacienda la escoge a mano en cada evento,
 * de la lista de banqueteros (decisión de Eduardo). Tampoco se le pone
 * banquetero al evento: el cliente es la persona.
 *
 * Como las demás importaciones: `/conciliar/paquetes` no escribe y
 * `/importar/paquetes` aplica lo que conciliar marcaría `aplicar`. Idempotente:
 * mandarlo dos veces deja lo mismo (`sinCambios`).
 */

export const lotePaquetesSchema = z.object({
  paquetes: z
    .array(
      z.object({
        /** El `idBI` con el que se importó el evento (no su código actual). */
        idBI: z.string().min(1).max(100),
        /** La `clave` del paquete en `/catalogos.paquetesAlimentos`. */
        clave: z.string().min(1).max(100),
        comision: z.object({ monto: montoNoNegativoSchema }).nullish(),
      }),
    )
    .min(1)
    .max(500),
});

type Estado = 'aplicar' | 'aplicado' | 'sinCambios' | 'noEncontrado' | 'cancelado' | 'sinPactado' | 'claveDesconocida' | 'comisionInvalida';

interface Resultado {
  idBI: string;
  estado: Estado;
  quoteId?: string;
  codigo?: string | null;
  paquete?: { clave: string; nombre: string };
  comision?: number | null;
  /** El paquete existe, pero no en el catálogo del evento (la clave es la misma en todos). */
  avisos?: string[];
  error?: string;
}

interface Plan {
  resultado: Resultado;
  aplicar?: { quoteId: string; breakdown: QuoteBreakdown; nombre: string; comision: number | null };
}

async function planear(db: PrismaClient, p: z.infer<typeof lotePaquetesSchema>['paquetes'][number]): Promise<Plan> {
  const base: Resultado = { idBI: p.idBI, estado: 'noEncontrado' };
  const q = await db.quote.findUnique({
    where: { importadoBI: p.idBI },
    select: { id: true, etiqueta: true, status: true, breakdown: true, priceListId: true, deletedAt: true },
  });
  if (!q || q.deletedAt) return { resultado: { ...base, error: 'No hay un evento importado con ese idBI.' } };
  const ident = { quoteId: q.id, codigo: q.etiqueta };
  if (q.status === 'cancelada') {
    return { resultado: { ...base, ...ident, estado: 'cancelado', error: 'El evento está cancelado aquí: no se toca.' } };
  }

  const candidatos = await db.foodPackage.findMany({
    where: { clave: p.clave },
    select: { nombre: true, priceListId: true, eventType: { select: { nombre: true } } },
  });
  const suyo = candidatos.find((c) => c.priceListId === q.priceListId) ?? candidatos[0];
  if (!suyo) return { resultado: { ...base, ...ident, estado: 'claveDesconocida', error: `No hay un paquete con la clave ${p.clave}.` } };
  const nombre = `${suyo.nombre} · ${suyo.eventType.nombre}`;
  const avisos = suyo.priceListId === q.priceListId ? undefined : ['El paquete no está en el catálogo del evento; se guarda por su clave.'];

  const antes = q.breakdown as unknown as QuoteBreakdown;
  const comision = p.comision?.monto ?? null;
  const pactado = antes.lines.find((l) => l.grupo === 'otros' && !l.cargoId && l.ref?.tipo === 'pactado');
  if (!pactado) {
    return { resultado: { ...base, ...ident, estado: 'sinPactado', error: 'El evento no tiene renglón de alimentos y servicios pactado.' } };
  }
  if (comision != null && comision > pactado.monto) {
    return {
      resultado: { ...base, ...ident, estado: 'comisionInvalida', error: `La comisión (${pesosTexto(comision)}) es mayor que los alimentos y servicios (${pesosTexto(pactado.monto)}).` },
    };
  }
  const resultado: Resultado = { ...ident, idBI: p.idBI, estado: 'aplicar', paquete: { clave: p.clave, nombre }, comision, ...(avisos ? { avisos } : {}) };
  if (pactado.ref?.paqueteClave === p.clave && (pactado.ref.comisionMonto ?? null) === comision) {
    return { resultado: { ...resultado, estado: 'sinCambios' } };
  }
  const breakdown = conPaquetePactado(antes, { clave: p.clave, comisionMonto: comision })!;
  return { resultado, aplicar: { quoteId: q.id, breakdown, nombre, comision } };
}

function resumen(resultados: Resultado[]) {
  const cuenta: Partial<Record<Estado, number>> = {};
  for (const r of resultados) cuenta[r.estado] = (cuenta[r.estado] ?? 0) + 1;
  return { total: resultados.length, ...cuenta };
}

/** Qué pasaría con cada renglón. No escribe nada. */
export async function conciliarPaquetes(db: PrismaClient, raw: unknown) {
  const { paquetes } = lotePaquetesSchema.parse(raw);
  const resultados: Resultado[] = [];
  for (const p of paquetes) resultados.push((await planear(db, p)).resultado);
  return { resumen: resumen(resultados), resultados };
}

/** Aplica los `aplicar`; lo demás se reporta igual que en conciliar. */
export async function importarPaquetes(db: PrismaClient, raw: unknown) {
  const { paquetes } = lotePaquetesSchema.parse(raw);
  const resultados: Resultado[] = [];
  for (const p of paquetes) {
    const { resultado, aplicar } = await planear(db, p);
    if (!aplicar) {
      resultados.push(resultado);
      continue;
    }
    await db.quote.update({
      where: { id: aplicar.quoteId },
      data: { breakdown: aplicar.breakdown as unknown as Prisma.InputJsonValue },
    });
    await logActivity(db, {
      quoteId: aplicar.quoteId,
      tipo: 'edicion',
      descripcion:
        `Paquete de alimentos desde el BI: ${aplicar.nombre}` +
        (aplicar.comision != null ? ` · comisión de la agencia ${pesosTexto(aplicar.comision)}` : '') +
        '. El monto pactado no cambia.',
      meta: { biPaquete: { clave: p.clave, comisionMonto: aplicar.comision } },
    });
    resultados.push({ ...resultado, estado: 'aplicado' });
  }
  return { resumen: resumen(resultados), resultados };
}
