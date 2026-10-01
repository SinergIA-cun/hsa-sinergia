import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, QuoteError, type Actor } from '../quotes/service.js';
import { ServerStorage } from './storage.js';
import { registerPayment } from './service.js';
import { estadoFolios, fijarSiguienteFolio } from './folios.js';
import { registrarDeposito, asignarDeposito, anularAsignacion } from '../banqueteros/cuenta.js';
import { crearApartado, convertirApartado } from '../banqueteros/apartados.js';
import { registrarAbono } from '../banqueteros/abonos.js';
import { biIngresos, biPagos } from '../bi/service.js';

/**
 * Folios de la serie I (uno por cada dinero que entra) y pagos divididos en
 * varias formas. Lo que se prueba es la regla del dueño: "estos folios se usan
 * cada vez que hay un pago" — y un depósito repartido es UN pago, no tres.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-folios-test-' + randomUUID()));

let app: FastifyInstance;
let admin: Actor;
let arcosId: string;
let eventTypeId: string;
let banqueteroId: string;
const quotes: string[] = [];
const clients: string[] = [];

const PRIMER_SABADO = '2041-01-05';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevoEvento(deBanquetero = false) {
  const q = await createQuote(
    prisma,
    {
      fecha: siguienteSabado(),
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      client: { telefono: '5555550000', nombre: 'Folios Test' },
      ...(deBanquetero ? { banqueteroId } : {}),
    },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

/** El folio que va a salir, sin gastarlo. */
async function siguienteFolio() {
  return (await estadoFolios(prisma)).siguiente;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  banqueteroId = (await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Folios ${randomUUID().slice(0, 6)}` } })).id;
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId } });
  await prisma.banquetero.delete({ where: { id: banqueteroId } });
  await prisma.cambioFolio.deleteMany({ where: { actorId: admin.id } });
  await app.close();
});

describe('pago dividido en varias formas', () => {
  it('débito y crédito en UN pago: un folio, método mixto y las dos partes guardadas', async () => {
    const q = await nuevoEvento();
    const antes = await siguienteFolio();
    const { payment } = await registerPayment(
      prisma,
      storage,
      q.id,
      {
        monto: 10_000,
        formas: [
          { forma: 'tarjetaDebito', monto: 6_000 },
          { forma: 'tarjetaCredito', monto: 4_000 },
        ],
        fecha: '2026-10-02',
      },
      admin,
    );
    expect(payment.folio).toBe(antes);
    expect(payment.metodo).toBe('mixto');
    expect(payment.formas).toEqual([
      { forma: 'tarjetaDebito', monto: 6_000 },
      { forma: 'tarjetaCredito', monto: 4_000 },
    ]);
    // Un solo pago, no dos.
    expect(await prisma.payment.count({ where: { quoteId: q.id } })).toBe(1);
    expect(await siguienteFolio()).toBe(antes + 1);
  });

  it('si las partes no suman el monto, se rechaza con 400 y no se registra nada', async () => {
    const q = await nuevoEvento();
    const intento = registerPayment(
      prisma,
      storage,
      q.id,
      {
        monto: 10_000,
        formas: [
          { forma: 'efectivo', monto: 6_000 },
          { forma: 'cheque', monto: 3_000 },
        ],
        fecha: '2026-10-02',
      },
      admin,
    );
    await expect(intento).rejects.toMatchObject({ status: 400 });
    expect(await prisma.payment.count({ where: { quoteId: q.id } })).toBe(0);
  });

  it('por la ruta en multipart: las formas llegan como un campo con JSON', async () => {
    const q = await nuevoEvento();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const cookie = login.cookies[0]!;
    const frontera = '----hsaFolios';
    const campo = (n: string, v: string) =>
      `--${frontera}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    const cuerpo =
      campo('monto', '9000') +
      campo('fecha', '2026-10-03') +
      campo('concepto', 'anticipo') +
      campo('formas', JSON.stringify([{ forma: 'efectivo', monto: 2_000 }, { forma: 'transferencia', monto: 7_000 }])) +
      `--${frontera}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/quotes/${q.id}/payments`,
      cookies: { [cookie.name]: cookie.value },
      headers: { 'content-type': `multipart/form-data; boundary=${frontera}` },
      payload: cuerpo,
    });
    expect(res.statusCode).toBe(201);
    const pago = res.json().payment;
    expect(pago.metodo).toBe('mixto');
    expect(pago.formas).toHaveLength(2);
  });

  it('un solo método sigue funcionando y se guarda como una parte', async () => {
    const q = await nuevoEvento();
    const { payment } = await registerPayment(
      prisma, storage, q.id, { monto: 5_000, metodo: 'cheque', fecha: '2026-10-02' }, admin,
    );
    expect(payment.metodo).toBe('cheque');
    expect(payment.formas).toEqual([{ forma: 'cheque', monto: 5_000 }]);
  });
});

describe('un folio por cada dinero que entra', () => {
  it('un depósito repartido en dos eventos gasta UN folio y los dos pagos lo llevan', async () => {
    const a = await nuevoEvento(true);
    const b = await nuevoEvento(true);
    const deposito = await registrarDeposito(
      prisma,
      storage,
      banqueteroId,
      {
        monto: 100_000,
        formas: [
          { forma: 'transferencia', monto: 90_000 },
          { forma: 'cheque', monto: 10_000 },
        ],
        fecha: '2026-10-05',
      },
      admin,
    );
    expect(deposito.folio).not.toBeNull();
    expect(deposito.metodo).toBe('mixto');
    const despuesDelDeposito = await siguienteFolio();

    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      deposito.id,
      { asignaciones: [{ quoteId: a.id, monto: 50_000 }, { quoteId: b.id, monto: 50_000 }] },
      admin,
    );
    expect(pagos.map((p) => p.folio)).toEqual([deposito.folio, deposito.folio]);
    // Cada evento con su letra: I 5340-A, I 5340-B.
    expect(pagos.map((p) => p.folioLetra)).toEqual(['A', 'B']);
    // Repartir no gastó folios.
    expect(await siguienteFolio()).toBe(despuesDelDeposito);
    // Y los pagos heredan que fue en varias formas, sin inventar las proporciones.
    const guardados = await prisma.payment.findMany({ where: { pagoBanqueteroId: deposito.id } });
    expect(guardados.every((p) => p.metodo === 'mixto' && p.formas === null)).toBe(true);
  });

  it('abonar desde el saldo lleva el folio del depósito; un abono directo gasta el suyo y el pago al convertir lo hereda', async () => {
    const deposito = await registrarDeposito(
      prisma, storage, banqueteroId, { monto: 30_000, metodo: 'transferencia', fecha: '2026-10-06' }, admin,
    );
    const { apartado } = await crearApartado(
      prisma, banqueteroId, { fechaEvento: siguienteSabado(), spaceIds: [arcosId] }, admin,
    );
    const { abonos } = await asignarDeposito(
      prisma, storage, deposito.id, { apartados: [{ apartadoId: apartado.id, monto: 20_000 }] }, admin,
    );
    const desdeDeposito = await prisma.abonoApartado.findUniqueOrThrow({ where: { id: abonos[0]!.abonoId } });
    expect(desdeDeposito.folio).toBe(deposito.folio);
    expect(desdeDeposito.folioLetra).toBe('A');

    const antes = await siguienteFolio();
    const directo = await registrarAbono(
      prisma, storage, apartado.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-10-07' }, admin,
    );
    expect(directo.folio).toBe(antes);

    const { quote } = await convertirApartado(
      prisma, storage, apartado.id, { eventTypeId, invitados: 250, client: { telefono: '5555550000', nombre: 'Folios Convertido' } }, admin,
    );
    quotes.push(quote.id);
    clients.push(quote.clientId);
    const pagos = await prisma.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } });
    expect(pagos.map((p) => p.folio)).toEqual([deposito.folio, directo.folio]);
    // El pago que nació del abono conserva su letra; el abono directo no tiene.
    expect(pagos.map((p) => p.folioLetra)).toEqual(['A', null]);
    // Convertir tampoco gastó folios.
    expect(await siguienteFolio()).toBe(antes + 1);
  });
});

describe('las letras de un depósito repartido', () => {
  it('un segundo reparto sigue la letra donde se quedó el primero, y una anulada no se reutiliza', async () => {
    const [a, b, c] = [await nuevoEvento(true), await nuevoEvento(true), await nuevoEvento(true)];
    const deposito = await registrarDeposito(
      prisma, storage, banqueteroId, { monto: 90_000, metodo: 'transferencia', fecha: '2026-10-10' }, admin,
    );
    const primero = await asignarDeposito(
      prisma, storage, deposito.id, { asignaciones: [{ quoteId: a.id, monto: 30_000 }] }, admin,
    );
    await anularAsignacion(prisma, deposito.id, primero.pagos[0]!.paymentId, 'iba a otro evento', admin);
    const segundo = await asignarDeposito(
      prisma, storage, deposito.id,
      { asignaciones: [{ quoteId: b.id, monto: 30_000 }, { quoteId: c.id, monto: 30_000 }] }, admin,
    );
    expect(primero.pagos.map((p) => p.folioLetra)).toEqual(['A']);
    expect(segundo.pagos.map((p) => p.folioLetra)).toEqual(['B', 'C']);
    const bi = (await biPagos(prisma, {
      desde: new Date('2026-10-10T00:00:00Z'), hasta: new Date('2026-10-10T23:59:59Z'), limit: 500,
    })).filter((p) => p.pagoBanqueteroId === deposito.id);
    expect(bi.map((p) => p.folioTexto).sort()).toEqual([
      `I ${deposito.folio}-A`, `I ${deposito.folio}-B`, `I ${deposito.folio}-C`,
    ]);
  });
});

describe('el folio con el que arranca la serie', () => {
  it('el admin lo fija, el siguiente dinero lo toma y queda el rastro', async () => {
    const { ultimoUsado } = await estadoFolios(prisma);
    const arranque = Math.max(ultimoUsado ?? 0, 5331) + 1_000;
    const estado = await fijarSiguienteFolio(prisma, { siguiente: arranque }, admin);
    expect(estado.siguiente).toBe(arranque);
    expect(estado.siguienteTexto).toBe(`I ${arranque}`);
    expect(estado.cambios[0]).toMatchObject({ siguiente: arranque });

    const q = await nuevoEvento();
    const { payment } = await registerPayment(
      prisma, storage, q.id, { monto: 1_000, metodo: 'efectivo', fecha: '2026-10-08' }, admin,
    );
    expect(payment.folio).toBe(arranque);
  });

  it('no puede ir hacia atrás de un folio ya usado', async () => {
    const { ultimoUsado } = await estadoFolios(prisma);
    await expect(fijarSiguienteFolio(prisma, { siguiente: ultimoUsado! }, admin)).rejects.toBeInstanceOf(QuoteError);
    await expect(fijarSiguienteFolio(prisma, { siguiente: ultimoUsado! }, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('ventas no lo puede cambiar', async () => {
    await expect(
      fijarSiguienteFolio(prisma, { siguiente: 999_999_999 }, { id: admin.id, role: 'ventas' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('por la ruta: solo admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/folios' });
    expect(res.statusCode).toBe(401);
  });
});

describe('BI', () => {
  it('/ingresos: una fila por folio; /pagos: una por aplicación, con el folio repetido', async () => {
    const a = await nuevoEvento(true);
    const b = await nuevoEvento(true);
    const fecha = '2026-10-20';
    const deposito = await registrarDeposito(
      prisma, storage, banqueteroId, { monto: 60_000, metodo: 'transferencia', fecha }, admin,
    );
    await asignarDeposito(
      prisma, storage, deposito.id,
      { asignaciones: [{ quoteId: a.id, monto: 30_000 }, { quoteId: b.id, monto: 30_000 }] }, admin,
    );
    const rango = { desde: new Date(`${fecha}T00:00:00Z`), hasta: new Date(`${fecha}T23:59:59Z`), limit: 500 };
    const ingresos = (await biIngresos(prisma, rango)).filter((f) => f.folio === deposito.folio);
    expect(ingresos).toHaveLength(1);
    expect(ingresos[0]).toMatchObject({ tipo: 'deposito', monto: 60_000, folioTexto: `I ${deposito.folio}` });

    const pagos = (await biPagos(prisma, rango)).filter((p) => p.folio === deposito.folio);
    expect(pagos).toHaveLength(2);
    expect(pagos.every((p) => p.pagoBanqueteroId === deposito.id)).toBe(true);
  });
});
