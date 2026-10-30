import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@hsa/database';
import { z } from 'zod';
import { requireApiKey } from './apiKey.js';
import { importarLote, conciliarLote } from './importar.js';
import { conciliarBanqueteros, importarBanqueteros } from './banqueteros.js';
import { conciliarApartados, importarApartados } from './apartados.js';
import { conciliarPaquetes, importarPaquetes } from './paquetes.js';
import { facturarVarios, mesActual, mesSchema, pagosDelMes } from '../facturacion/facturar.js';
import { biEventos, biPagos, biIngresos, biCargos, biDevoluciones, biPagosEsperados, biCambios, biFacturacion, biApartados, biCatalogos, type RangoBI } from './service.js';

const LIMITE_MAX = 500;
const LIMITE_DEFAULT = 100;

const querySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
  /** Ids de eventos separados por coma (hasta 100): relee esos sin importar la fecha. */
  ids: z
    .string()
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(40)).min(1).max(100))
    .optional(),
});

/** Rango por omisión: el año en curso. El BI casi siempre manda el suyo. */
function aRango(q: z.infer<typeof querySchema>): RangoBI {
  const hoy = new Date();
  const desde = q.desde ? new Date(`${q.desde}T00:00:00.000Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
  const hasta = q.hasta ? new Date(`${q.hasta}T23:59:59.999Z`) : new Date(Date.UTC(hoy.getUTCFullYear(), 11, 31, 23, 59, 59));
  // El tope es duro: un BI que pida 100000 recibe 500, no un timeout.
  const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAX);
  return { desde, hasta, limit, cursor: q.cursor, ids: q.ids };
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
  await rutasDeImportacion(app);
  const llave = app.config.BI_API_KEY;
  if (!llave) return;
  const guardia = requireApiKey(llave);

  const endpoints: [string, ConsultaBI][] = [
    ['eventos', biEventos],
    ['pagos', biPagos],
    ['ingresos', biIngresos],
    ['cargos', biCargos],
    ['devoluciones', biDevoluciones],
    ['pagos-esperados', biPagosEsperados],
    ['cambios', biCambios],
    ['facturacion', biFacturacion],
    ['apartados', biApartados],
  ];

  app.get('/bi/catalogos', { preHandler: guardia }, async () => biCatalogos(app.prisma));

  // Los pagos de un mes para facturar: pendientes, facturados y los que no se facturan.
  app.get('/bi/facturacion/pagos', { preHandler: guardia }, async (req, reply) => {
    const mes = z.object({ mes: mesSchema.optional() }).safeParse(req.query);
    if (!mes.success) return reply.code(400).send({ error: 'mes como AAAA-MM' });
    return pagosDelMes(app.prisma, mes.data.mes ?? mesActual());
  });

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

/**
 * La única escritura del BI: mandar los eventos vendidos antes del sistema, de
 * cualquier fecha, y conciliarlos. Con su propia llave
 * (`BI_IMPORT_API_KEY`); sin ella estas rutas no existen.
 *
 * `/conciliar` nunca escribe. `/importar/eventos` crea los nuevos y liga los que
 * vienen con `folioHSA`; lo que ya existe no se sobrescribe, se reporta. Los
 * banqueteros y los apartados van igual: `/conciliar/banqueteros`,
 * `/importar/banqueteros`, `/conciliar/apartados` e `/importar/apartados`.
 */
async function rutasDeImportacion(app: FastifyInstance): Promise<void> {
  const llave = app.config.BI_IMPORT_API_KEY;
  if (!llave) return;
  const guardia = requireApiKey(llave);
  // Un lote de 200 eventos con sus pagos cabe de sobra en 5 MB.
  const opciones = { preHandler: guardia, bodyLimit: 5 * 1024 * 1024 };
  app.post('/bi/conciliar', opciones, async (req) => conciliarLote(app.prisma, req.body));
  app.post('/bi/importar/eventos', opciones, async (req) => importarLote(app.prisma, req.body));
  app.post('/bi/conciliar/banqueteros', opciones, async (req) => conciliarBanqueteros(app.prisma, req.body));
  app.post('/bi/importar/banqueteros', opciones, async (req) => importarBanqueteros(app.prisma, req.body));
  app.post('/bi/conciliar/apartados', opciones, async (req) => conciliarApartados(app.prisma, req.body));
  app.post('/bi/importar/apartados', opciones, async (req) => importarApartados(app.prisma, req.body));
  app.post('/bi/conciliar/paquetes', opciones, async (req) => conciliarPaquetes(app.prisma, req.body));
  app.post('/bi/importar/paquetes', opciones, async (req) => importarPaquetes(app.prisma, req.body));

  // Facturar con el PAC: unos pagos (`pagoIds`) o todos los pendientes de un mes
  // (`todos: true`, con `mes` o el mes en curso). Uno por uno, hasta 100 por llamada.
  app.post('/bi/facturacion/facturar', { preHandler: guardia }, async (req, reply) => {
    const body = facturarBiSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Manda pagoIds (1 a 100) o todos: true', issues: body.error.issues });
    const ids = body.data.todos
      ? (await pagosDelMes(app.prisma, body.data.mes ?? mesActual())).pendientes.pagos.map((p) => p.pagoId).slice(0, MAX_FACTURAS)
      : body.data.pagoIds!;
    return facturarVarios(app.prisma, ids, { proveedor: app.facturacion, mailer: app.mailer, actorId: null, origen: 'BI' });
  });
}

const MAX_FACTURAS = 100;
const facturarBiSchema = z
  .object({
    pagoIds: z.array(z.string().min(1).max(40)).min(1).max(MAX_FACTURAS).optional(),
    todos: z.literal(true).optional(),
    mes: mesSchema.optional(),
  })
  .refine((b) => (b.pagoIds ? !b.todos : b.todos === true), 'pagoIds o todos, uno de los dos');
