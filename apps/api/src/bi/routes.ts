import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@hsa/database';
import { z } from 'zod';
import { requireApiKey } from './apiKey.js';
import { biEventos, biPagos, biPagosEsperados, biCambios, biFacturacion, type RangoBI } from './service.js';

const LIMITE_MAX = 500;
const LIMITE_DEFAULT = 100;

const querySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

/** Rango por omisión: el año en curso. El BI casi siempre manda el suyo. */
function aRango(q: z.infer<typeof querySchema>): RangoBI {
  const hoy = new Date();
  const desde = q.desde ? new Date(`${q.desde}T00:00:00.000Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
  const hasta = q.hasta ? new Date(`${q.hasta}T23:59:59.999Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 11, 31, 23, 59, 59));
  // El tope es duro: un BI que pida 100000 recibe 500, no un timeout.
  const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAX);
  return { desde, hasta, limit, cursor: q.cursor };
}

/**
 * Las cinco consultas comparten firma, así que las rutas se generan en un ciclo
 * sin castear nada: `Promise<X[]>` es asignable a `Promise<unknown[]>`.
 */
type ConsultaBI = (db: PrismaClient, r: RangoBI) => Promise<unknown[]>;

/**
 * API de solo lectura para el BI del cliente. Ni un endpoint de escritura.
 * Se registra únicamente si hay `BI_API_KEY`; sin ella estas rutas no existen.
 */
export async function biRoutes(app: FastifyInstance): Promise<void> {
  const llave = app.config.BI_API_KEY;
  if (!llave) return;
  const guardia = requireApiKey(llave);

  const endpoints: [string, ConsultaBI][] = [
    ['eventos', biEventos],
    ['pagos', biPagos],
    ['pagos-esperados', biPagosEsperados],
    ['cambios', biCambios],
    ['facturacion', biFacturacion],
  ];

  for (const [nombre, consulta] of endpoints) {
    app.get(`/bi/${nombre}`, { preHandler: guardia }, async (req, reply) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'Parámetros inválidos' });
      const rango = aRango(parsed.data);
      const datos = await consulta(app.prisma, rango);
      return {
        desde: rango.desde.toISOString().slice(0, 10),
        hasta: rango.hasta.toISOString().slice(0, 10),
        limit: rango.limit,
        // Cursor para la siguiente página: el id del último elemento, o null si
        // vino menos de `limit` (ya no hay más).
        //
        // Ojo: /pagos-esperados devuelve hitos derivados que NO tienen `id`
        // propio, así que su cursor siempre sale null. Ver docs/API-BI.md: ese
        // endpoint no pagina, acota por rango de vencimiento.
        siguienteCursor:
          datos.length === rango.limit ? ((datos[datos.length - 1] as { id?: string }).id ?? null) : null,
        datos,
      };
    });
  }
}
