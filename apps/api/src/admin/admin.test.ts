import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let adminCookie: { name: string; value: string };
const createdAddOnIds: string[] = [];

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const cookie = login.cookies[0]!;
  adminCookie = { name: cookie.name, value: cookie.value };
});

afterAll(async () => {
  await prisma.addOn.deleteMany({ where: { id: { in: createdAddOnIds } } });
  // Restaura valetRatio por si algún assert falla antes de la restauración manual.
  await prisma.pricingConfig.update({ where: { id: 'default' }, data: { valetRatio: 2.5 } });
  await app.close();
});

describe('admin add-ons', () => {
  it('POST /admin/addons crea; PATCH /admin/addons/:id actualiza', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/addons',
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { nombre: 'Test Extra', kind: 'fijo', price: 500 },
    });
    expect(createRes.statusCode).toBe(201);
    const addOn = createRes.json().addOn;
    createdAddOnIds.push(addOn.id);
    expect(addOn.nombre).toBe('Test Extra');
    expect(addOn.price).toBe(500);
    expect(addOn.activo).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/addons/${addOn.id}`,
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { price: 600, activo: false },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json().addOn;
    expect(updated.price).toBe(600);
    expect(updated.activo).toBe(false);
  });
});

describe('admin config', () => {
  it('GET /admin/config devuelve valetRatio', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/config',
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config).toHaveProperty('valetRatio');
  });

  it('PATCH /admin/config actualiza valetRatio y luego se restaura', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { valetRatio: 3 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().config.valetRatio).toBe(3);

    const restoreRes = await app.inject({
      method: 'PATCH',
      url: '/api/admin/config',
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { valetRatio: 2.5 },
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json().config.valetRatio).toBe(2.5);
  });

  it('GET /catalog incluye config.valetRatio', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/catalog',
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config).toHaveProperty('valetRatio');
  });

  it('GET /admin/config sin auth => 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/config' });
    expect(res.statusCode).toBe(401);
  });
});
