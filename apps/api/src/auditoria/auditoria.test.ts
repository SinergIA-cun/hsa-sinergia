import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { PrismaClient, prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { listarAuditoria } from './consulta.js';
import { mantenimientoAuditoria } from './mantenimiento.js';

/**
 * La bitácora que capta TODO.
 *
 * El pedido del dueño fue literal: "aún si yo inyecto algo o borro directo de
 * SQL debería mostrarlo la bitácora". Lo que se fija aquí es exactamente eso, y
 * la señal que lo hace útil: **un cambio sin actor es un cambio que no vino de
 * la app**. Si esa distinción se rompe, la bitácora sigue llena de renglones y
 * deja de servir para lo único que se pidió.
 */

let app: FastifyInstance;
let adminCookie: { name: string; value: string };
let adminId: string;
let ventasCookie: { name: string; value: string };
const ventasEmail = `ventas-auditoria-${randomUUID()}@haciendasanandres.com.mx`;
let ventasId: string;
const banqueteros: string[] = [];

/**
 * Un cliente de base de datos que se hace pasar por otra cosa.
 *
 * Es la pieza del experimento: conecta con su propio `application_name`, así que
 * para Postgres es un origen distinto de la API — igual que una sesión de psql o
 * la consola del proveedor. Sin esto no se puede probar lo que se pidió.
 */
let externo: PrismaClient;

function cookie() {
  return { [adminCookie.name]: adminCookie.value };
}

/** Los renglones que la bitácora guardó de una fila concreta, del más nuevo al más viejo. */
function auditoriaDe(tabla: string, registroId: string) {
  return prisma.auditoriaDb.findMany({ where: { tabla, registroId }, orderBy: { id: 'desc' } });
}

async function nuevoBanquetero(nombre: string): Promise<string> {
  const b = await prisma.banquetero.create({ data: { nombre, publicToken: randomUUID() } });
  banqueteros.push(b.id);
  return b.id;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
  });
  const c = login.cookies[0]!;
  adminCookie = { name: c.name, value: c.value };
  adminId = (
    await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } })
  ).id;

  const ventas = await prisma.user.create({
    data: {
      nombre: 'Ventas Auditoría',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = ventas.id;
  const loginVentas = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ventasEmail, password: 'ventas1234' },
  });
  const cv = loginVentas.cookies[0]!;
  ventasCookie = { name: cv.name, value: cv.value };

  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('application_name', 'psql-simulado');
  externo = new PrismaClient({ datasources: { db: { url: url.toString() } } });
});

afterAll(async () => {
  await externo.$disconnect();
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await prisma.user.deleteMany({ where: { id: ventasId } });
  await app.close();
});

describe('lo que entra por fuera de la app', () => {
  it('registra un UPDATE hecho por SQL directo, sin actor y con el origen a la vista', async () => {
    const id = await nuevoBanquetero('Auditoría · tocado por fuera');

    await externo.$executeRawUnsafe(
      `UPDATE "Banquetero" SET nombre = 'Cambiado por fuera' WHERE id = $1`,
      id,
    );

    const filas = await auditoriaDe('Banquetero', id);
    const update = filas.find((f) => f.operacion === 'UPDATE');
    expect(update, 'el cambio por SQL directo tiene que quedar registrado').toBeDefined();
    // La señal: sin actor. Nadie de la app hizo esto.
    expect(update!.actorId).toBeNull();
    expect(update!.aplicacion).toBe('psql-simulado');
    expect((update!.antes as { nombre: string }).nombre).toBe('Auditoría · tocado por fuera');
    expect((update!.despues as { nombre: string }).nombre).toBe('Cambiado por fuera');
  });

  it('registra un DELETE hecho por SQL directo con la fila que se llevó', async () => {
    const id = await nuevoBanquetero('Auditoría · borrado por fuera');

    await externo.$executeRawUnsafe(`DELETE FROM "Banquetero" WHERE id = $1`, id);

    const filas = await auditoriaDe('Banquetero', id);
    const del = filas.find((f) => f.operacion === 'DELETE');
    expect(del, 'borrar por fuera tiene que dejar rastro').toBeDefined();
    expect(del!.actorId).toBeNull();
    // La fila borrada queda completa: es lo único que queda de ella.
    expect((del!.antes as { nombre: string }).nombre).toBe('Auditoría · borrado por fuera');
  });
});

describe('lo que entra por la app', () => {
  it('le pone nombre a la persona que hizo el cambio', async () => {
    const id = await nuevoBanquetero('Auditoría · tocado por la app');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/banqueteros/${id}`,
      cookies: cookie(),
      payload: { nombre: 'Renombrado desde la app' },
    });
    expect(res.statusCode).toBe(200);

    const filas = await auditoriaDe('Banquetero', id);
    const update = filas.find((f) => f.operacion === 'UPDATE');
    expect(update).toBeDefined();
    // Esto es lo que prueba que el puente funciona de punta a punta: la cookie
    // se volvió `SET LOCAL app.actor_id` dentro de la transacción de Prisma y el
    // trigger de Postgres lo leyó.
    expect(update!.actorId).toBe(adminId);
    expect(update!.aplicacion).toBe('hsa-api');
  });

  it('no le pega el actor de una petición a la siguiente', async () => {
    // El miedo concreto: el pool reusa conexiones. Si el actor se sellara con un
    // `SET` de sesión en vez de un `SET LOCAL` dentro de la transacción, el
    // cambio de una persona quedaría firmado por la anterior que usó esa misma
    // conexión. Atribuirle a alguien un movimiento que no hizo es peor que no
    // saber quién lo hizo.
    const id = await nuevoBanquetero('Auditoría · dos manos');

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/banqueteros/${id}`,
      cookies: cookie(),
      payload: { nombre: 'Tocado por el admin' },
    });
    // Ventas no puede editar banqueteros, así que su escritura entra por donde sí
    // puede: apartar una fecha para este banquetero.
    const apartado = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/${id}/apartados`,
      cookies: { [ventasCookie.name]: ventasCookie.value },
      payload: {
        fechaEvento: '2039-11-19',
        spaceIds: [(await prisma.space.findFirstOrThrow()).id],
        vence: '2039-10-19',
      },
    });
    expect(apartado.statusCode).toBe(201);
    const apartadoId = apartado.json().apartado.id as string;

    const delAdmin = (await auditoriaDe('Banquetero', id)).find((f) => f.operacion === 'UPDATE');
    const deVentas = (await auditoriaDe('ApartadoFecha', apartadoId)).find(
      (f) => f.operacion === 'INSERT',
    );
    expect(delAdmin!.actorId).toBe(adminId);
    expect(deVentas!.actorId).toBe(ventasId);

    await prisma.apartadoFecha.delete({ where: { id: apartadoId } });
  });

  it('no ensucia la bitácora con un UPDATE que no cambia nada', async () => {
    const id = await nuevoBanquetero('Auditoría · sin cambios');
    const antes = (await auditoriaDe('Banquetero', id)).length;

    await prisma.banquetero.update({ where: { id }, data: { nombre: 'Auditoría · sin cambios' } });

    expect((await auditoriaDe('Banquetero', id)).length).toBe(antes);
  });

  it('registra el cambio de contraseña pero nunca guarda el hash', async () => {
    const usuario = await prisma.user.create({
      data: {
        nombre: 'Auditoría · contraseña',
        email: `pass-auditoria-${randomUUID()}@haciendasanandres.com.mx`,
        passwordHash: await hashPassword('primera1234'),
        role: 'ventas',
      },
    });

    await prisma.user.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashPassword('segunda1234') },
    });

    const filas = await auditoriaDe('User', usuario.id);
    const update = filas.find((f) => f.operacion === 'UPDATE');
    // Que quede registrado importa: si el hash se quitara ANTES de comparar, un
    // cambio de contraseña se leería como "no cambió nada" y desaparecería.
    expect(update, 'cambiar una contraseña tiene que dejar rastro').toBeDefined();
    expect(Object.keys(update!.despues as object)).not.toContain('passwordHash');
    expect(Object.keys(update!.antes as object)).not.toContain('passwordHash');

    await prisma.user.delete({ where: { id: usuario.id } });
  });
});

describe('la bitácora se defiende', () => {
  it('rechaza que le borren un renglón', async () => {
    const fila = await prisma.auditoriaDb.findFirstOrThrow({ orderBy: { id: 'desc' } });
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditoriaDb" WHERE id = ${fila.id}`),
    ).rejects.toThrow(/no se edita ni se borra/);
  });

  it('rechaza que le editen un renglón', async () => {
    const fila = await prisma.auditoriaDb.findFirstOrThrow({ orderBy: { id: 'desc' } });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditoriaDb" SET "actorId" = 'otro' WHERE id = ${fila.id}`),
    ).rejects.toThrow(/no se edita ni se borra/);
  });
});

describe('ninguna tabla se queda sin auditar', () => {
  it('engancha una tabla nueva y no vuelve a engancharla', async () => {
    const tabla = `zz_prueba_auditoria_${randomUUID().replace(/-/g, '')}`;
    await prisma.$executeRawUnsafe(`CREATE TABLE "${tabla}" (id text PRIMARY KEY, valor text)`);
    try {
      const primera = await mantenimientoAuditoria(prisma, 3650);
      expect(primera.tablasEnganchadas).toBeGreaterThanOrEqual(1);

      // Y ya enganchada, registra: no basta con que exista el trigger.
      await prisma.$executeRawUnsafe(`INSERT INTO "${tabla}" VALUES ('x1', 'algo')`);
      const filas = await prisma.auditoriaDb.findMany({ where: { tabla } });
      expect(filas).toHaveLength(1);
      expect(filas[0]!.operacion).toBe('INSERT');

      // Idempotente: un segundo arranque no vuelve a enganchar nada.
      const segunda = await mantenimientoAuditoria(prisma, 3650);
      expect(segunda.tablasEnganchadas).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE "${tabla}"`);
    }
  });
});

describe('la retención', () => {
  it('poda lo viejo, respeta lo reciente y no deja la puerta abierta', async () => {
    // Un renglón plantado en el pasado. Es la única vez que este código escribe
    // en la bitácora a mano, y es para probar la poda.
    const viejo = await prisma.auditoriaDb.create({
      data: {
        tabla: 'ZZPruebaRetencion',
        operacion: 'INSERT',
        registroId: randomUUID(),
        usuarioDb: 'prueba',
        txid: '0',
        createdAt: new Date(Date.now() - 3650 * 86_400_000),
      },
    });
    const reciente = await prisma.auditoriaDb.create({
      data: {
        tabla: 'ZZPruebaRetencion',
        operacion: 'INSERT',
        registroId: randomUUID(),
        usuarioDb: 'prueba',
        txid: '0',
      },
    });

    const resultado = await mantenimientoAuditoria(prisma, 1825);
    expect(resultado.purgados).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditoriaDb.findUnique({ where: { id: viejo.id } })).toBeNull();
    expect(await prisma.auditoriaDb.findUnique({ where: { id: reciente.id } })).not.toBeNull();

    // Y la puerta se vuelve a cerrar: el permiso de purga muere con su
    // transacción, no se queda abierto para el resto de la sesión.
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditoriaDb" WHERE id = ${reciente.id}`),
    ).rejects.toThrow(/no se edita ni se borra/);
  });
});

describe('la consulta', () => {
  it('aísla lo que no vino de la app', async () => {
    const id = await nuevoBanquetero('Auditoría · filtro externos');
    await externo.$executeRawUnsafe(
      `UPDATE "Banquetero" SET nombre = 'Movido por fuera' WHERE id = $1`,
      id,
    );
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/banqueteros/${id}`,
      cookies: cookie(),
      payload: { nombre: 'Movido por la app' },
    });

    const todo = await listarAuditoria(prisma, { tabla: 'Banquetero', registroId: id });
    expect(todo.filas.filter((f) => f.origen === 'persona').length).toBeGreaterThan(0);
    expect(todo.filas.filter((f) => f.origen === 'externo').length).toBeGreaterThan(0);

    const soloFuera = await listarAuditoria(prisma, {
      tabla: 'Banquetero',
      registroId: id,
      origen: 'externo',
    });
    expect(soloFuera.filas.length).toBeGreaterThan(0);
    expect(soloFuera.filas.every((f) => f.aplicacion === 'psql-simulado')).toBe(true);
    // El resumen del encabezado: lo de afuera de los últimos 30 días.
    expect(soloFuera.externosRecientes).toBeGreaterThan(0);
  });

  it('no confunde nuestros propios procesos con alguien metiendo mano', async () => {
    const id = await nuevoBanquetero('Auditoría · proceso del sistema');
    // Una escritura de nuestro código SIN persona detrás: un backfill, una
    // migración, el reconciliador del arranque. Va por el cliente de la app,
    // pero fuera de cualquier petición, así que no tiene actor.
    await prisma.banquetero.update({ where: { id }, data: { telefono: '5500000000' } });

    const { filas } = await listarAuditoria(prisma, { tabla: 'Banquetero', registroId: id });
    const update = filas.find((f) => f.operacion === 'UPDATE');
    expect(update).toBeDefined();
    // Sin actor, sí — pero NO externo. Si esto se marcara como externo, cada
    // despliegue con backfill dispararía la alarma y nadie volvería a mirarla.
    expect(update!.actorId).toBeNull();
    expect(update!.origen).toBe('sistema');

    const soloFuera = await listarAuditoria(prisma, {
      tabla: 'Banquetero',
      registroId: id,
      origen: 'externo',
    });
    expect(soloFuera.filas).toHaveLength(0);
  });

  it('resume qué campos cambió cada UPDATE', async () => {
    const id = await nuevoBanquetero('Auditoría · campos');
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/banqueteros/${id}`,
      cookies: cookie(),
      payload: { nombre: 'Auditoría · campos', telefono: '5511223344' },
    });

    const { filas } = await listarAuditoria(prisma, { tabla: 'Banquetero', registroId: id });
    const update = filas.find((f) => f.operacion === 'UPDATE');
    expect(update).toBeDefined();
    expect(update!.campos).toEqual(['telefono']);
    expect(update!.actorNombre).toBe('Administrador');
  });

  it('la bitácora forense es solo de admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/auditoria',
      cookies: { [ventasCookie.name]: ventasCookie.value },
    });
    expect(res.statusCode).toBe(403);
  });
});
