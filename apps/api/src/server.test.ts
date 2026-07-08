import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('GET /health responde { ok: true }', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('auth', () => {
  const email = 'admin@haciendasanandres.com.mx';

  it('login con credenciales válidas devuelve user y set-cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'admin1234' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(email);
    expect(res.json().user.role).toBe('admin');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('login con contraseña incorrecta => 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'incorrecta' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me sin cookie => 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me con cookie válida => user', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(email);
  });
});
