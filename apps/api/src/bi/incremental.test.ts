import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, softDeleteQuote, type Actor } from '../quotes/service.js';
import { registerPayment, anularPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';

/**
 * Lo que el BI necesita para leer lo INCREMENTAL cada minuto (issue #2 del canal):
 * `/cambios` dice qué evento cambió —incluso si se fue a la papelera— y `?ids=`
 * relee ese evento y su dinero sin importar la fecha.
 */

const LLAVE = 'c'.repeat(64);
const storage = new ServerStorage(join(tmpdir(), 'hsa-bi-incremental-' + randomUUID()));
let app: FastifyInstance;
let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url, headers: { 'x-api-key': LLAVE } });
  expect(r.statusCode, url).toBe(200);
  return r.json();
};

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
  await app.close();
});

let semana = 0;
const sabado = () => new Date(Date.UTC(2054, 0, 3 + 7 * semana++)).toISOString().slice(0, 10);

async function evento() {
  const q = await createQuote(
    prisma,
    { fecha: sabado(), invitados: 200, spaceIds: [arcosId], eventTypeId: bodaId, client: { nombre: 'Incremental BI', telefono: '5512121212' } },
    admin,
  );
  quotes.push(q.id);
  return q;
}

describe('lectura incremental del BI', () => {
  it('?ids= relee el evento y su dinero sin importar la fecha, con los salones por nombre', async () => {
    const q = await evento();
    const { payment } = await registerPayment(prisma, storage, q.id, { monto: 20_000, metodo: 'efectivo', fecha: '2026-10-05' }, admin);
    // Sin ids, el rango por omisión (el año en curso) no lo trae: su fecha es 2054.
    const ev = await get(`/api/bi/eventos?ids=${q.id}`);
    expect(ev.datos.map((e: { id: string }) => e.id)).toEqual([q.id]);
    expect(ev.datos[0].salones).toEqual(['Arcos']);
    const pagos = await get(`/api/bi/pagos?ids=${q.id},otro-id`);
    expect(pagos.datos.map((p: { id: string }) => p.id)).toEqual([payment.id]);
  });

  it('/cambios avisa de una anulación y de la papelera, aunque el evento ya no salga en /eventos', async () => {
    const q = await evento();
    const { payment } = await registerPayment(prisma, storage, q.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-05' }, admin);
    await anularPayment(prisma, q.id, payment.id, 'Prueba de anulación', admin);
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'borrador' } });
    await softDeleteQuote(prisma, q.id, admin);

    const hoy = new Date().toISOString().slice(0, 10);
    let cursor: string | null = null;
    const mios: { tipo: string; eventoEnPapelera: boolean }[] = [];
    do {
      const r = await get(`/api/bi/cambios?desde=${hoy}&hasta=${hoy}&limit=500${cursor ? `&cursor=${cursor}` : ''}`);
      mios.push(...r.datos.filter((c: { quoteId: string }) => c.quoteId === q.id));
      cursor = r.siguienteCursor;
    } while (cursor);
    expect(mios.map((c) => c.tipo)).toEqual(expect.arrayContaining(['creada', 'pago', 'pagoAnulado', 'eliminada']));
    expect(mios.every((c) => c.eventoEnPapelera)).toBe(true);
    expect((await get(`/api/bi/eventos?ids=${q.id}`)).datos).toEqual([]);
  });

  it('/catalogos trae espacios, tipos y los valores fijos', async () => {
    const c = await get('/api/bi/catalogos');
    expect(c.espacios.map((e: { nombre: string }) => e.nombre)).toEqual(expect.arrayContaining(['Arcos', 'Cúpula']));
    expect(c.tiposEvento.map((t: { nombre: string }) => t.nombre)).toContain('Boda');
    expect(c.productosCargo.map((p: { producto: string }) => p.producto)).toContain('multa');
    expect(c.estatusEvento).toContain('standby');
  });

  it('ids mal formados o de más de 100 son 400', async () => {
    const muchos = Array.from({ length: 101 }, (_, i) => `id${i}`).join(',');
    const r = await app.inject({ method: 'GET', url: `/api/bi/eventos?ids=${muchos}`, headers: { 'x-api-key': LLAVE } });
    expect(r.statusCode).toBe(400);
  });

  it('/eventos trae la capilla, el salón principal y la renta repartida por salón (suma la renta)', async () => {
    const cupulaId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Cúpula' } })).id;
    const q = await createQuote(
      prisma,
      {
        fecha: sabado(),
        invitados: 300,
        spaceIds: [cupulaId, arcosId],
        eventTypeId: bodaId,
        usaCapilla: true,
        capillaHorario: '17:00',
        client: { nombre: 'Dos salones', telefono: '5512121299' },
      },
      admin,
    );
    quotes.push(q.id);
    const [ev] = (await get(`/api/bi/eventos?ids=${q.id}`)).datos;
    expect(ev).toMatchObject({ usaCapilla: true, capillaHorario: '17:00', salonPrincipal: { id: cupulaId, nombre: 'Cúpula' } });
    expect(ev.rentaPorSalon.map((r: { salon: string }) => r.salon)).toEqual(['Cúpula', 'Arcos']);
    const suma = ev.rentaPorSalon.reduce((s: number, r: { monto: number }) => s + r.monto, 0);
    expect(suma).toBeCloseTo(ev.renta.total, 2);
    expect(ev.rentaPorSalon.every((r: { monto: number }) => r.monto > 0)).toBe(true);
  });
});

