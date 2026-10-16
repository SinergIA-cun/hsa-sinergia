import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@hsa/database';
import { PLANTILLAS_WHATSAPP } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let cookie: Record<string, string>;

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' } });
  const c = login.cookies[0]!;
  cookie = { [c.name]: c.value };
});

afterAll(async () => {
  await prisma.ajuste.deleteMany({ where: { clave: 'whatsapp.plantillas' } });
  await app.close();
});

describe('plantillas de WhatsApp', () => {
  it('trae las de arranque; el admin edita una; vacía regresa a la de arranque', async () => {
    await prisma.ajuste.deleteMany({ where: { clave: 'whatsapp.plantillas' } });
    const ini = await app.inject({ method: 'GET', url: '/api/whatsapp/plantillas', cookies: cookie });
    expect(ini.json().plantillas.saludo).toMatchObject({ texto: PLANTILLAS_WHATSAPP.saludo.texto, editada: false });

    const put = await app.inject({ method: 'PUT', url: '/api/admin/whatsapp/plantillas', cookies: cookie, payload: { plantillas: { saludo: 'Hola {cliente}!' } } });
    expect(put.json().plantillas.saludo).toMatchObject({ texto: 'Hola {cliente}!', editada: true });

    const reset = await app.inject({ method: 'PUT', url: '/api/admin/whatsapp/plantillas', cookies: cookie, payload: { plantillas: { saludo: '' } } });
    expect(reset.json().plantillas.saludo).toMatchObject({ texto: PLANTILLAS_WHATSAPP.saludo.texto, editada: false });

    const mala = await app.inject({ method: 'PUT', url: '/api/admin/whatsapp/plantillas', cookies: cookie, payload: { plantillas: { inventada: 'x' } } });
    expect(mala.statusCode).toBe(400);
  });
});
