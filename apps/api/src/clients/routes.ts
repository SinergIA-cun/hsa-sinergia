import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { ServerStorage } from '../payments/storage.js';

/** Búsqueda de clientes existentes para reutilizarlos al cotizar (evita
 *  duplicados y números de referencia SPEI repetidos). */
export async function clientRoutes(app: FastifyInstance): Promise<void> {
  // La CSF se guarda con la misma infraestructura que los comprobantes de pago.
  const storage = new ServerStorage(app.config.COMPROBANTES_DIR);

  const CSF_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

  app.post<{ Params: { id: string } }>('/clients/:id/csf', { preHandler: requireAuth }, async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'Se espera multipart con el archivo en el campo "csf".' });
    }
    let archivo: { data: Buffer; mime: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'csf') {
        const buf = await part.toBuffer();
        if (buf.length > 0) archivo = { data: buf, mime: part.mimetype };
      }
    }
    if (!archivo) return reply.code(400).send({ error: 'Falta el archivo.' });
    if (!CSF_MIMES.has(archivo.mime)) {
      return reply.code(400).send({ error: 'La constancia debe ser PDF, JPG o PNG.' });
    }
    const guardado = await storage.save(archivo.data, archivo.mime);
    await app.prisma.client.update({
      where: { id: req.params.id },
      data: { csfKey: guardado.key, csfMime: guardado.mime },
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/clients/:id/csf', { preHandler: requireAuth }, async (req, reply) => {
    const cliente = await app.prisma.client.findUnique({
      where: { id: req.params.id },
      select: { csfKey: true, csfMime: true },
    });
    if (!cliente?.csfKey) return reply.code(404).send({ error: 'Sin constancia.' });
    const data = await storage.load(cliente.csfKey);
    if (!data) return reply.code(404).send({ error: 'Sin constancia.' });
    return reply.type(cliente.csfMime ?? 'application/octet-stream').send(data);
  });

  app.get<{ Querystring: { q?: string } }>('/clients', { preHandler: requireAuth }, async (req) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return { clients: [] };
    const clients = await app.prisma.client.findMany({
      where: {
        OR: [
          { nombre: { contains: q, mode: 'insensitive' } },
          { telefono: { contains: q } },
          { correo: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nombre: true,
        telefono: true,
        correo: true,
        empresa: true,
        numeroReferencia: true,
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        cpFiscal: true,
        usoCfdi: true,
        correoFacturacion: true,
      },
      orderBy: { nombre: 'asc' },
      take: 8,
    });
    return { clients };
  });
}
