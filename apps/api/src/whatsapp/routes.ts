import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@hsa/database';
import { ETAPAS_WHATSAPP, PLANTILLAS_WHATSAPP, type EtapaWhatsapp } from '@hsa/shared';
import { requireAdmin, requireAuth } from '../auth/plugin.js';

/**
 * Los textos de WhatsApp por etapa (reunión del 15-oct-2026). Los de arranque
 * viven en `@hsa/shared`; lo que el admin cambie se guarda en `Ajuste` y gana.
 * Dejar un texto vacío lo regresa al de arranque.
 */
const CLAVE = 'whatsapp.plantillas';

const guardarSchema = z.object({
  plantillas: z.record(z.enum(ETAPAS_WHATSAPP), z.string().max(1000)),
});

export async function plantillasWhatsapp(db: PrismaClient) {
  const a = await db.ajuste.findUnique({ where: { clave: CLAVE } });
  const propias = (a?.valor ?? {}) as Partial<Record<EtapaWhatsapp, string>>;
  return Object.fromEntries(
    ETAPAS_WHATSAPP.map((k) => [
      k,
      { titulo: PLANTILLAS_WHATSAPP[k].titulo, texto: propias[k]?.trim() || PLANTILLAS_WHATSAPP[k].texto, porDefecto: PLANTILLAS_WHATSAPP[k].texto, editada: Boolean(propias[k]?.trim()) },
    ]),
  );
}

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get('/whatsapp/plantillas', { preHandler: requireAuth }, async () => ({ plantillas: await plantillasWhatsapp(app.prisma) }));

  app.put('/admin/whatsapp/plantillas', { preHandler: requireAdmin }, async (req) => {
    const { plantillas } = guardarSchema.parse(req.body);
    const a = await app.prisma.ajuste.findUnique({ where: { clave: CLAVE } });
    const actuales = (a?.valor ?? {}) as Record<string, string>;
    const nuevas = { ...actuales };
    for (const [k, v] of Object.entries(plantillas)) {
      if (v.trim()) nuevas[k] = v.trim();
      else delete nuevas[k];
    }
    await app.prisma.ajuste.upsert({ where: { clave: CLAVE }, create: { clave: CLAVE, valor: nuevas }, update: { valor: nuevas } });
    return { plantillas: await plantillasWhatsapp(app.prisma) };
  });
}
