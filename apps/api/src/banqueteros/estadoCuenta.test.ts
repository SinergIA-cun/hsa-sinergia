import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, softDeleteQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registrarDeposito, asignarDeposito, anularAsignacion } from './cuenta.js';
import { crearApartado } from './apartados.js';
import { estadoCuentaBanquetero, estadoCuentaPublico } from './estadoCuenta.js';

const storage = new ServerStorage(join(tmpdir(), 'hsa-ecb-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let arcosId: string;
let eventTypeId: string;
/** El banquetero de la prueba grande: tres eventos y un depósito de 323,345. */
let ramirezId: string;
/** Uno intacto, para el caso "sin nada devuelve ceros". */
let vacioId: string;
/** Un tercero, para probar que el enlace público no filtra al vecino. */
let vecinoId: string;
const ventasEmail = `ventas-ecb-${randomUUID()}@haciendasanandres.com.mx`;
let ventasId: string;
const quotes: string[] = [];
const clients: string[] = [];
const banqueteros: string[] = [];

const PRIMER_SABADO = '2034-01-07';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function evento(deQuien: string, nombre: string) {
  const q = await createQuote(
    prisma,
    {
      fecha: siguienteSabado(),
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      banqueteroId: deQuien,
      festejado: nombre,
      client: { nombre: 'Cliente del banquetero' },
    },
    actor,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const v = await prisma.user.create({
    data: {
      nombre: 'Vendedora de estados de cuenta',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = v.id;
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const [r, vac, vec] = await Promise.all([
    prisma.banquetero.create({ data: { nombre: `Ramírez EC ${randomUUID().slice(0, 6)}` } }),
    prisma.banquetero.create({ data: { nombre: `Vacío EC ${randomUUID().slice(0, 6)}` } }),
    prisma.banquetero.create({ data: { nombre: `Vecino EC ${randomUUID().slice(0, 6)}` } }),
  ]);
  ramirezId = r.id;
  vacioId = vac.id;
  vecinoId = vec.id;
  banqueteros.push(r.id, vac.id, vec.id);
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

async function cookies(email: string, password: string) {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const c = login.cookies[0]!;
  return { [c.name]: c.value };
}

describe('estado de cuenta del banquetero', () => {
  /**
   * LA PRUEBA QUE DA SENTIDO AL PLAN, en los números del dueño: un depósito de
   * $323,345 y tres eventos; 55,000 / 55,000 / el resto.
   */
  it('el reparto de 323,345 entre tres eventos cuadra en el estado de cuenta', async () => {
    const [a, b, c] = [
      await evento(ramirezId, 'Generación A'),
      await evento(ramirezId, 'Generación B'),
      await evento(ramirezId, 'Generación C'),
    ];
    const dep = await registrarDeposito(
      prisma,
      storage,
      ramirezId,
      { monto: 323_345, metodo: 'transferencia', fecha: '2026-03-05', referencia: 'SPEI grande' },
      actor,
    );
    await asignarDeposito(
      prisma,
      storage,
      dep.id,
      {
        asignaciones: [
          { quoteId: a.id, monto: 55_000 },
          { quoteId: b.id, monto: 55_000 },
          { quoteId: c.id, monto: 213_345 },
        ],
      },
      actor,
    );

    const ec = await estadoCuentaBanquetero(prisma, ramirezId);
    expect(ec.totales.eventos).toBe(3);
    expect(ec.totales.depositado).toBe(323_345);
    expect(ec.totales.saldoSinAsignar).toBe(0);
    expect(ec.totales.pagado).toBe(323_345);

    const porFestejado = new Map(ec.eventos.map((e) => [e.festejado, e]));
    expect(porFestejado.get('Generación A')!.pagado).toBe(55_000);
    expect(porFestejado.get('Generación B')!.pagado).toBe(55_000);
    expect(porFestejado.get('Generación C')!.pagado).toBe(213_345);
    // Cada evento con su recibo: tres folios distintos colgados del mismo depósito.
    expect(ec.depositos[0]!.asignaciones).toHaveLength(3);
    expect(new Set(ec.depositos[0]!.asignaciones.map((x) => x.folio)).size).toBe(3);
  });

  it('el saldo sin asignar es Σ depósitos vivos − Σ asignaciones vivas', async () => {
    const b = await prisma.banquetero.create({ data: { nombre: `Saldos ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const uno = await evento(b.id, 'Uno');

    const d1 = await registrarDeposito(prisma, storage, b.id, { monto: 100_000, metodo: 'efectivo', fecha: '2026-03-05' }, actor);
    const d2 = await registrarDeposito(prisma, storage, b.id, { monto: 58_345, metodo: 'transferencia', fecha: '2026-04-01' }, actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(158_345);

    const { pagos } = await asignarDeposito(prisma, storage, d1.id, { asignaciones: [{ quoteId: uno.id, monto: 40_000 }] }, actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(118_345);

    // Anular la asignación devuelve el monto al saldo.
    await anularAsignacion(prisma, d1.id, pagos[0]!.paymentId, 'iba a otro evento', actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(158_345);

    // Y un depósito anulado deja de sumar.
    await asignarDeposito(prisma, storage, d1.id, { asignaciones: [{ quoteId: uno.id, monto: 100_000 }] }, actor);
    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.totales.saldoSinAsignar).toBe(58_345);
    expect(ec.totales.depositado).toBe(158_345);
    void d2;
  });

  it('un banquetero sin nada devuelve ceros, no un error', async () => {
    const ec = await estadoCuentaBanquetero(prisma, vacioId);
    expect(ec.eventos).toEqual([]);
    expect(ec.depositos).toEqual([]);
    expect(ec.apartados).toEqual([]);
    expect(ec.totales).toMatchObject({
      eventos: 0,
      rentaTotal: 0,
      pagado: 0,
      saldo: 0,
      depositado: 0,
      saldoSinAsignar: 0,
      apartadosVivos: 0,
      apartadosPorVencer: 0,
    });
  });

  it('un banquetero que no existe da 404', async () => {
    await expect(estadoCuentaBanquetero(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('las cotizaciones en la papelera NO aparecen', async () => {
    const b = await prisma.banquetero.create({ data: { nombre: `Papelera ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const viva = await evento(b.id, 'Viva');
    const muerta = await evento(b.id, 'A la papelera');
    await softDeleteQuote(prisma, muerta.id, actor);

    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.eventos.map((e) => e.quoteId)).toEqual([viva.id]);
    expect(ec.totales.eventos).toBe(1);
  });

  it('trae los apartados y los que vencen en los próximos 30 días', async () => {
    const b = await prisma.banquetero.create({ data: { nombre: `Vence ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    // Las fechas salen del reloj y NO de constantes: `crearApartado` rechaza un
    // vencimiento pasado contra el día real, así que un `vence` fijo convierte
    // la prueba en una bomba de tiempo que truena sola al llegar esa fecha.
    const hoy = hoyCivilMexico();
    const enDias = (n: number): string =>
      new Date(hoy.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const cerca = enDias(10); // dentro de la ventana de 30 días
    const lejos = enDias(300); // fuera de la ventana

    await crearApartado(prisma, b.id, { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: cerca }, actor);
    await crearApartado(prisma, b.id, { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: lejos }, actor);

    const ec = await estadoCuentaBanquetero(prisma, b.id, { hoy });
    expect(ec.apartados).toHaveLength(2);
    expect(ec.totales.apartadosVivos).toBe(2);
    // Solo el cercano entra en la ventana de 30 días.
    expect(ec.totales.apartadosPorVencer).toBe(1);
    expect(ec.apartadosPorVencer[0]!.vence.toISOString()).toBe(`${cerca}T00:00:00.000Z`);
    // Y el apartado NO suma a la renta comprometida: no tiene total.
    expect(ec.totales.rentaTotal).toBe(0);
  });

  it('GET /banqueteros/:id/estado-cuenta: admin y ventas sí, anónimo 401', async () => {
    const anon = await app.inject({ method: 'GET', url: `/api/banqueteros/${ramirezId}/estado-cuenta` });
    expect(anon.statusCode).toBe(401);

    for (const c of [
      await cookies('admin@haciendasanandres.com.mx', 'admin1234'),
      await cookies(ventasEmail, 'ventas1234'),
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/banqueteros/${ramirezId}/estado-cuenta`, cookies: c });
      expect(res.statusCode).toBe(200);
      expect(res.json().totales.eventos).toBe(3);
    }
  });
});

describe('el enlace compartible de solo lectura', () => {
  it('cada banquetero nace con su token de 32 caracteres, distinto del vecino', async () => {
    const [r, v] = await Promise.all([
      prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } }),
      prisma.banquetero.findUniqueOrThrow({ where: { id: vecinoId } }),
    ]);
    expect(r.publicToken).toHaveLength(32);
    expect(r.publicToken).not.toBe(v.publicToken);
  });

  it('GET /b/:token sirve el estado de cuenta SIN sesión', async () => {
    const r = await prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } });
    const res = await app.inject({ method: 'GET', url: `/api/b/${r.publicToken}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.banquetero.nombre).toContain('Ramírez EC');
    expect(body.eventos).toHaveLength(3);
    expect(body.totales.saldoSinAsignar).toBe(0);
  });

  it('un token inválido da 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/b/no-existe' })).statusCode).toBe(404);
    expect(await estadoCuentaPublico(prisma, 'no-existe')).toBeNull();
  });

  it('el token de uno NO expone los datos de otro', async () => {
    const vecinoEvento = await evento(vecinoId, 'Evento del vecino');
    const r = await prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } });
    const publico = await estadoCuentaPublico(prisma, r.publicToken);

    expect(publico!.banquetero.nombre).toContain('Ramírez EC');
    expect(publico!.eventos.map((e) => e.festejado)).not.toContain('Evento del vecino');
    // Y por el otro token se ve exactamente lo del otro, nada más.
    const v = await prisma.banquetero.findUniqueOrThrow({ where: { id: vecinoId } });
    const delVecino = await estadoCuentaPublico(prisma, v.publicToken);
    expect(delVecino!.eventos.map((e) => e.festejado)).toEqual(['Evento del vecino']);
    void vecinoEvento;
  });

  it('la vista pública es una proyección: no filtra comprobantes, actores ni motivos', async () => {
    const b = await prisma.banquetero.create({ data: { nombre: `Proyección ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const q = await evento(b.id, 'Proyectado');
    const dep = await registrarDeposito(
      prisma,
      storage,
      b.id,
      { monto: 50_000, metodo: 'transferencia', fecha: '2026-03-05', referencia: 'SPEI 1' },
      actor,
      { data: Buffer.from('ficha'), mime: 'image/jpeg' },
    );
    const { pagos } = await asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: q.id, monto: 20_000 }] }, actor);
    await anularAsignacion(prisma, dep.id, pagos[0]!.paymentId, 'motivo interno que no se publica', actor);

    const token = (await prisma.banquetero.findUniqueOrThrow({ where: { id: b.id } })).publicToken;
    const publico = await estadoCuentaPublico(prisma, token);
    const json = JSON.stringify(publico);

    expect(json).not.toContain('comprobanteKey');
    expect(json).not.toContain(dep.comprobanteKey!);
    expect(json).not.toContain('registradoById');
    expect(json).not.toContain('motivo interno que no se publica');
    expect(json).not.toContain(actor.id);
    // La asignación anulada no se publica; el saldo vuelve a estar completo.
    expect(publico!.depositos[0]!.asignaciones).toHaveLength(0);
    expect(publico!.depositos[0]!.saldoSinAsignar).toBe(50_000);
  });

  it('un depósito anulado no se publica', async () => {
    const b = await prisma.banquetero.create({ data: { nombre: `Anulado ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const dep = await registrarDeposito(prisma, storage, b.id, { monto: 10_000, metodo: 'efectivo', fecha: '2026-03-05' }, actor);
    await prisma.pagoBanquetero.update({ where: { id: dep.id }, data: { anuladoAt: new Date() } });

    const token = (await prisma.banquetero.findUniqueOrThrow({ where: { id: b.id } })).publicToken;
    const publico = await estadoCuentaPublico(prisma, token);
    expect(publico!.depositos).toHaveLength(0);
    expect(publico!.totales.depositado).toBe(0);
  });
});
