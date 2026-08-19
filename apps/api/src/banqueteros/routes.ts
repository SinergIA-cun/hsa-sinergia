import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/plugin.js';
import { QuoteError, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { anularSchema } from '../payments/service.js';
import {
  registrarDeposito,
  asignarDeposito,
  anularAsignacion,
  anularDeposito,
  listarDepositos,
  loadComprobanteDeposito,
} from './cuenta.js';
import { crearApartado, listarApartados, cancelarApartado, convertirApartado } from './apartados.js';
import { estadoCuentaBanquetero, estadoCuentaPublico } from './estadoCuenta.js';

/**
 * La cuenta corriente del banquetero.
 *
 * Ojo con las rutas: `GET /banqueteros` ya existe en `admin/routes.ts` (el
 * desplegable de la hoja operativa) y Fastify truena al registrar una ruta
 * repetida. Todo lo de aquí cuelga de `/banqueteros/:id/...` o de
 * `/banqueteros/depositos/...`, que no chocan con ella.
 */
export async function banqueteroRoutes(app: FastifyInstance): Promise<void> {
  // El mismo directorio y la misma clase que los comprobantes de pago: la ficha
  // del banco de un depósito es un comprobante como cualquier otro.
  const storage = new ServerStorage(app.config.COMPROBANTES_DIR);

  // Registrar un depósito a cuenta. Acepta multipart (foto de la ficha desde la
  // tablet) o JSON, igual que el registro de pagos.
  app.post<{ Params: { id: string } }>(
    '/banqueteros/:id/depositos',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let rawInput: Record<string, unknown>;
      let file: { data: Buffer; mime: string } | undefined;

      if (req.isMultipart()) {
        const fields: Record<string, string> = {};
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            const buf = await part.toBuffer();
            if (part.fieldname === 'comprobante' && buf.length > 0) {
              file = { data: buf, mime: part.mimetype };
            }
          } else {
            fields[part.fieldname] = String(part.value);
          }
        }
        rawInput = {
          monto: fields.monto != null ? Number(fields.monto) : undefined,
          metodo: fields.metodo,
          fecha: fields.fecha,
          referencia: fields.referencia || undefined,
        };
      } else {
        rawInput = (req.body ?? {}) as Record<string, unknown>;
      }

      try {
        const deposito = await registrarDeposito(
          app.prisma,
          storage,
          req.params.id,
          rawInput,
          req.user as Actor,
          file,
        );
        return reply.code(201).send({ deposito });
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e; // ZodError → 400 vía el handler global
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/banqueteros/:id/depositos',
    { preHandler: requireAuth },
    async (req) => ({ depositos: await listarDepositos(app.prisma, req.params.id) }),
  );

  // Repartir el depósito entre los eventos del banquetero. VENTAS puede repartir
  // sobre lo suyo: es la instrucción del banquetero sobre dinero que ya entró, no
  // un movimiento nuevo.
  app.post<{ Params: { depositoId: string } }>(
    '/banqueteros/depositos/:depositoId/asignaciones',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const result = await asignarDeposito(
          app.prisma,
          storage,
          req.params.depositoId,
          req.body,
          req.user as Actor,
        );
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.patch<{ Params: { depositoId: string; paymentId: string } }>(
    '/banqueteros/depositos/:depositoId/asignaciones/:paymentId/anular',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = anularSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Motivo requerido' });
      try {
        const deposito = await anularAsignacion(
          app.prisma,
          req.params.depositoId,
          req.params.paymentId,
          parsed.data.motivo,
          req.user as Actor,
        );
        return { deposito };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.patch<{ Params: { depositoId: string } }>(
    '/banqueteros/depositos/:depositoId/anular',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const deposito = await anularDeposito(
          app.prisma,
          req.params.depositoId,
          req.body,
          req.user as Actor,
        );
        return { deposito };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // --- Apartados de fecha (sin precio) ---

  // Apartar una fecha. Lo puede hacer ventas: es vender una fecha, no mover dinero
  // ya recibido. El choque con una fecha comprometida avisa (409 con el detalle) y
  // se puede pasar con `confirmar: true`.
  app.post<{ Params: { id: string } }>(
    '/banqueteros/:id/apartados',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const result = await crearApartado(app.prisma, req.params.id, req.body, req.user as Actor);
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/banqueteros/:id/apartados',
    { preHandler: requireAuth },
    async (req) => ({ apartados: await listarApartados(app.prisma, req.params.id) }),
  );

  app.patch<{ Params: { apartadoId: string } }>(
    '/banqueteros/apartados/:apartadoId/cancelar',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        return { apartado: await cancelarApartado(app.prisma, req.params.apartadoId, req.body, req.user as Actor) };
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // Convertir el apartado en cotización. El cuerpo es el de crear una cotización
  // normal MENOS fecha, espacios y banquetero, que vienen del apartado.
  app.post<{ Params: { apartadoId: string } }>(
    '/banqueteros/apartados/:apartadoId/convertir',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const result = await convertirApartado(
          app.prisma,
          storage,
          req.params.apartadoId,
          req.body,
          req.user as Actor,
        );
        return reply.code(201).send(result);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // --- Estado de cuenta ---

  // Interno: admin y ventas. NO se filtra por pertenencia — el saldo de una
  // contraparte es uno solo y "sus eventos que además son míos" no cuadraría.
  app.get<{ Params: { id: string } }>(
    '/banqueteros/:id/estado-cuenta',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        return await estadoCuentaBanquetero(app.prisma, req.params.id);
      } catch (e) {
        if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // PÚBLICA: sin auth, de solo lectura y por token, igual que `/c/:token` del
  // cliente. Un token que no existe da 404 sin decir por qué.
  app.get<{ Params: { token: string } }>('/b/:token', async (req, reply) => {
    const result = await estadoCuentaPublico(app.prisma, req.params.token);
    if (!result) return reply.code(404).send({ error: 'No encontrado' });
    return result;
  });

  // La ficha del banco del depósito (interno; el enlace público no la expone).
  app.get<{ Params: { depositoId: string } }>(
    '/banqueteros/depositos/:depositoId/comprobante',
    { preHandler: requireAuth },
    async (req, reply) => {
      const c = await loadComprobanteDeposito(app.prisma, storage, req.params.depositoId);
      if (!c) return reply.code(404).send({ error: 'Comprobante no encontrado' });
      return reply.type(c.mime).send(c.data);
    },
  );
}
