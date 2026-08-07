import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

const LLAVE = 'a'.repeat(64);
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API del BI · llave', () => {
  it('sin llave responde 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos' });
    expect(r.statusCode).toBe(401);
  });

  it('con llave incorrecta responde 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'b'.repeat(64) } });
    expect(r.statusCode).toBe(401);
  });

  it('con llave de otra longitud responde 401 y no truena', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'corta' } });
    expect(r.statusCode).toBe(401);
  });

  it('con la llave correcta responde 200', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
    expect(r.statusCode).toBe(200);
  });

  it('el mensaje de error no revela la llave', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': 'b'.repeat(64) } });
    expect(r.body).not.toContain(LLAVE);
    expect(r.body).not.toContain('b'.repeat(64));
  });
});

describe('API del BI · sin llave configurada', () => {
  it('el módulo no existe y responde 404', async () => {
    const sinLlave = await buildServer({ config: { ...loadConfig(), BI_API_KEY: undefined } });
    await sinLlave.ready();
    const r = await sinLlave.inject({ method: 'GET', url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
    expect(r.statusCode).toBe(404);
    await sinLlave.close();
  });
});

describe('API del BI · datos', () => {
  it('cada endpoint responde con la envoltura estándar', async () => {
    for (const ruta of ['eventos', 'pagos', 'pagos-esperados', 'cambios', 'facturacion']) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/bi/${ruta}?desde=2020-01-01&hasta=2035-12-31`,
        headers: { 'x-api-key': LLAVE },
      });
      expect(r.statusCode, ruta).toBe(200);
      const body = r.json();
      expect(body, ruta).toHaveProperty('datos');
      expect(Array.isArray(body.datos), ruta).toBe(true);
      expect(body, ruta).toHaveProperty('siguienteCursor');
    }
  });

  it('el limit se recorta al tope duro', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/bi/eventos?limit=99999',
      headers: { 'x-api-key': LLAVE },
    });
    expect(r.json().limit).toBe(500);
  });

  it('rechaza un rango con formato inválido', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/bi/eventos?desde=marzo',
      headers: { 'x-api-key': LLAVE },
    });
    expect(r.statusCode).toBe(400);
  });

  it('no expone ningún endpoint de escritura', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const r = await app.inject({ method, url: '/api/bi/eventos', headers: { 'x-api-key': LLAVE } });
      expect(r.statusCode, method).toBe(404);
    }
  });
});
