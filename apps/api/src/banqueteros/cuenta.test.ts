import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { estadoFacturaPago, hoyCivilMexico } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, loadEstadoCuenta, softDeleteQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import {
  registrarDeposito,
  asignarDeposito,
  anularAsignacion,
  anularDeposito,
  listarDepositos,
  saldoSinAsignar,
} from './cuenta.js';

const storage = new ServerStorage(join(tmpdir(), 'hsa-banq-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let ventas: Actor;
let arcosId: string;
let eventTypeId: string;
let banqueteroId: string;
let otroBanqueteroId: string;
const ventasEmail = `ventas-banq-${randomUUID()}@haciendasanandres.com.mx`;
const quotes: string[] = [];
const clients: string[] = [];
const banqueteros: string[] = [];

/**
 * Cada cotización necesita SU PROPIA fecha: asignar un depósito registra un pago,
 * el pago formaliza el evento y el servidor ya rechaza cotizar sobre un espacio
 * comprometido. Se avanza de 7 en 7 días desde un sábado para que el desglose sea
 * idéntico en todas (el precio depende del tipo de día).
 */
const PRIMER_SABADO = '2032-01-03';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevoEvento(deQuien: string | null, creador: Actor = actor) {
  const q = await createQuote(
    prisma,
    {
      fecha: siguienteSabado(),
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      client: { nombre: 'Banquetero Cuenta Test' },
      ...(deQuien ? { banqueteroId: deQuien } : {}),
    },
    creador,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

async function nuevoDeposito(monto: number, fecha = '2026-03-05', quien = banqueteroId) {
  return registrarDeposito(
    prisma,
    storage,
    quien,
    { monto, metodo: 'transferencia', fecha, referencia: 'SPEI 998877' },
    actor,
  );
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const usuarioVentas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de banqueteros',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventas = { id: usuarioVentas.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const b1 = await prisma.banquetero.create({ data: { nombre: `Ramírez ${randomUUID().slice(0, 6)}` } });
  const b2 = await prisma.banquetero.create({ data: { nombre: `Otro ${randomUUID().slice(0, 6)}` } });
  banqueteroId = b1.id;
  otroBanqueteroId = b2.id;
  banqueteros.push(b1.id, b2.id);
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await prisma.user.delete({ where: { id: ventas.id } });
  await app.close();
});

async function cookiesDe(email: string, password: string) {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const cookie = login.cookies[0]!;
  return { [cookie.name]: cookie.value };
}
const adminCookies = () => cookiesDe('admin@haciendasanandres.com.mx', 'admin1234');
const ventasCookies = () => cookiesDe(ventasEmail, 'ventas1234');

describe('saldoSinAsignar (pura)', () => {
  it('resta solo las asignaciones vivas', () => {
    const dep = { monto: 323_345, anuladoAt: null };
    expect(saldoSinAsignar(dep, [])).toBe(323_345);
    expect(saldoSinAsignar(dep, [{ monto: 55_000, anuladoAt: null }])).toBe(268_345);
    expect(
      saldoSinAsignar(dep, [
        { monto: 55_000, anuladoAt: null },
        { monto: 55_000, anuladoAt: new Date() },
      ]),
    ).toBe(268_345);
  });

  it('un depósito anulado no tiene saldo que repartir', () => {
    expect(saldoSinAsignar({ monto: 100_000, anuladoAt: new Date() }, [])).toBe(0);
  });
});

describe('cuenta corriente del banquetero', () => {
  it('un depósito de 323,345 deja saldo sin asignar de 323,345', async () => {
    const dep = await nuevoDeposito(323_345);
    expect(dep.monto).toBe(323_345);
    expect(dep.saldoSinAsignar).toBe(323_345);
    expect(dep.asignaciones).toHaveLength(0);
  });

  it('asignar 55,000 al evento A crea un Payment con folio y baja el saldo a 268,345', async () => {
    const dep = await nuevoDeposito(323_345);
    const a = await nuevoEvento(banqueteroId);

    const { deposito, pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: a.id, monto: 55_000 }] },
      actor,
    );

    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.folio).toBeGreaterThan(0);
    expect(deposito.saldoSinAsignar).toBe(268_345);

    // El pago es un `Payment` REAL de la cotización, con su liga al depósito madre.
    const enLaCotizacion = await prisma.payment.findMany({ where: { quoteId: a.id } });
    expect(enLaCotizacion).toHaveLength(1);
    expect(enLaCotizacion[0]!.monto).toBe(55_000);
    expect(enLaCotizacion[0]!.pagoBanqueteroId).toBe(dep.id);

    // Y por lo tanto cuenta como pagado en el estado de cuenta del evento, sin
    // que el motor de estado de cuenta haya cambiado una línea.
    const { estadoCuenta } = await loadEstadoCuenta(prisma, { ...a, breakdown: a.breakdown });
    expect(estadoCuenta.pagado).toBe(55_000);
  });

  it('el reparto completo 55,000 / 55,000 / el resto deja el saldo en cero', async () => {
    const dep = await nuevoDeposito(323_345);
    const [a, b, c] = [await nuevoEvento(banqueteroId), await nuevoEvento(banqueteroId), await nuevoEvento(banqueteroId)];

    const { deposito, pagos } = await asignarDeposito(
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

    expect(deposito.saldoSinAsignar).toBe(0);
    expect(pagos.map((p) => p.monto)).toEqual([55_000, 55_000, 213_345]);
    // Tres folios distintos: un recibo por evento, un solo depósito detrás.
    expect(new Set(pagos.map((p) => p.folio)).size).toBe(3);
  });

  it('asignar más que el saldo sin asignar responde 409 y no crea nada', async () => {
    const dep = await nuevoDeposito(100_000);
    const a = await nuevoEvento(banqueteroId);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: a.id, monto: 100_001 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.payment.count({ where: { quoteId: a.id } })).toBe(0);
  });

  it('un reparto que se pasa en el ÚLTIMO renglón no deja los primeros hechos', async () => {
    const dep = await nuevoDeposito(100_000);
    const a = await nuevoEvento(banqueteroId);
    const b = await nuevoEvento(banqueteroId);
    await expect(
      asignarDeposito(
        prisma,
        storage,
        dep.id,
        {
          asignaciones: [
            { quoteId: a.id, monto: 60_000 },
            { quoteId: b.id, monto: 60_000 },
          ],
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.payment.count({ where: { quoteId: { in: [a.id, b.id] } } })).toBe(0);
    expect((await listarDepositos(prisma, banqueteroId)).find((d) => d.id === dep.id)!.saldoSinAsignar).toBe(100_000);
  });

  it('asignar a una cotización de OTRO banquetero responde 409', async () => {
    const dep = await nuevoDeposito(100_000);
    const ajena = await nuevoEvento(otroBanqueteroId);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: ajena.id, monto: 10_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.payment.count({ where: { quoteId: ajena.id } })).toBe(0);
  });

  it('asignar a una cotización SIN banquetero responde 409', async () => {
    const dep = await nuevoDeposito(100_000);
    const directa = await nuevoEvento(null);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: directa.id, monto: 10_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('asignar a una cotización en la papelera responde 409', async () => {
    const dep = await nuevoDeposito(100_000);
    const q = await nuevoEvento(banqueteroId);
    await softDeleteQuote(prisma, q.id, actor);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: q.id, monto: 10_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('anular una asignación devuelve el monto al saldo y anula su Payment', async () => {
    const dep = await nuevoDeposito(200_000);
    const a = await nuevoEvento(banqueteroId);
    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: a.id, monto: 80_000 }] },
      actor,
    );

    const despues = await anularAsignacion(prisma, dep.id, pagos[0]!.paymentId, 'iba al evento C', actor);
    expect(despues.saldoSinAsignar).toBe(200_000);

    const pago = await prisma.payment.findUnique({ where: { id: pagos[0]!.paymentId } });
    expect(pago!.anuladoAt).not.toBeNull();
    expect(pago!.motivoAnulacion).toBe('iba al evento C');
    // Y el evento deja de contarlo como pagado.
    const { estadoCuenta } = await loadEstadoCuenta(prisma, a);
    expect(estadoCuenta.pagado).toBe(0);
  });

  it('anular una asignación que no es de este depósito responde 404', async () => {
    const dep = await nuevoDeposito(50_000);
    const otro = await nuevoDeposito(50_000);
    const a = await nuevoEvento(banqueteroId);
    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      otro.id,
      { asignaciones: [{ quoteId: a.id, monto: 10_000 }] },
      actor,
    );
    await expect(anularAsignacion(prisma, dep.id, pagos[0]!.paymentId, 'error', actor)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('anular el depósito con asignaciones vivas responde 409; sin ellas, procede', async () => {
    const dep = await nuevoDeposito(90_000);
    const a = await nuevoEvento(banqueteroId);
    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: a.id, monto: 30_000 }] },
      actor,
    );

    await expect(anularDeposito(prisma, dep.id, { motivo: 'cheque devuelto' }, actor)).rejects.toMatchObject({
      status: 409,
    });

    await anularAsignacion(prisma, dep.id, pagos[0]!.paymentId, 'cheque devuelto', actor);
    const anulado = await anularDeposito(prisma, dep.id, { motivo: 'cheque devuelto' }, actor);
    expect(anulado.anuladoAt).not.toBeNull();
    expect(anulado.anuladoById).toBe(actor.id);
    expect(anulado.saldoSinAsignar).toBe(0);

    // Y un depósito anulado ya no se puede repartir.
    const b = await nuevoEvento(banqueteroId);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: b.id, monto: 1_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('el saldo sin asignar NO cuenta como pagado en ninguna cotización', async () => {
    const dep = await nuevoDeposito(150_000);
    const a = await nuevoEvento(banqueteroId);
    const { estadoCuenta } = await loadEstadoCuenta(prisma, a);
    expect(estadoCuenta.pagado).toBe(0);
    // El dinero existe en la cuenta del banquetero, no en el evento.
    expect((await listarDepositos(prisma, banqueteroId)).find((d) => d.id === dep.id)!.saldoSinAsignar).toBe(150_000);
    // Y no hay pagos colgados de aire: sin asignación no hay `Payment`.
    expect(await prisma.payment.count({ where: { pagoBanqueteroId: dep.id } })).toBe(0);
  });

  it('un monto con decimales se RECHAZA, no se redondea (Prisma trunca sin avisar)', async () => {
    await expect(
      registrarDeposito(prisma, storage, banqueteroId, { monto: 55_000.5, metodo: 'efectivo', fecha: '2026-03-05' }, actor),
    ).rejects.toThrow();
    const dep = await nuevoDeposito(100_000);
    const a = await nuevoEvento(banqueteroId);
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: a.id, monto: 10_000.9 }] }, actor),
    ).rejects.toThrow();
    expect(await prisma.payment.count({ where: { quoteId: a.id } })).toBe(0);
  });

  it('un depósito de un banquetero que no existe responde 404', async () => {
    await expect(
      registrarDeposito(prisma, storage, 'no-existe', { monto: 1_000, metodo: 'efectivo', fecha: '2026-03-05' }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('quién puede qué', () => {
  it('solo admin registra depósitos (ventas: 403)', async () => {
    await expect(
      registrarDeposito(prisma, storage, banqueteroId, { monto: 1_000, metodo: 'efectivo', fecha: '2026-03-05' }, ventas),
    ).rejects.toMatchObject({ status: 403 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/${banqueteroId}/depositos`,
      payload: { monto: 1_000, metodo: 'efectivo', fecha: '2026-03-05' },
      cookies: await ventasCookies(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('solo admin anula depósitos (ventas: 403)', async () => {
    const dep = await nuevoDeposito(10_000);
    await expect(anularDeposito(prisma, dep.id, { motivo: 'no entró' }, ventas)).rejects.toMatchObject({ status: 403 });
  });

  it('ventas SÍ puede repartir lo suyo, y no lo de otra vendedora', async () => {
    const dep = await nuevoDeposito(120_000);
    const suyo = await nuevoEvento(banqueteroId, ventas);
    const ajeno = await nuevoEvento(banqueteroId, actor);

    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: suyo.id, monto: 20_000 }] },
      ventas,
    );
    expect(pagos[0]!.folio).toBeGreaterThan(0);

    // El evento de otra persona ni existe para ella: 404, no 403.
    await expect(
      asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: ajeno.id, monto: 20_000 }] }, ventas),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('POST de un reparto por HTTP responde 201 y 409 cuando se pasa del saldo', async () => {
    const dep = await nuevoDeposito(70_000);
    const a = await nuevoEvento(banqueteroId);
    const cookies = await adminCookies();

    const ok = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/depositos/${dep.id}/asignaciones`,
      payload: { asignaciones: [{ quoteId: a.id, monto: 20_000 }] },
      cookies,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().deposito.saldoSinAsignar).toBe(50_000);

    const pasado = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/depositos/${dep.id}/asignaciones`,
      payload: { asignaciones: [{ quoteId: a.id, monto: 50_001 }] },
      cookies,
    });
    expect(pasado.statusCode).toBe(409);
  });
});

/**
 * EL RIESGO FISCAL DEL PLAN.
 *
 * El candado del Plan C corre POR PAGO y el SAT exige facturar el ingreso en el
 * mes en que se RECIBE. Un depósito de marzo repartido en mayo sigue siendo
 * ingreso de marzo: si el `Payment` que nace de la asignación llevara la fecha
 * del reparto, se facturaría fuera de mes.
 */
describe('el pago que nace de una asignación lleva la fecha del DEPÓSITO', () => {
  const MARZO = '2026-03-05';
  /** El "hoy" del reparto: mayo, dos meses después del depósito. */
  const MAYO = hoyCivilMexico(new Date('2026-05-20T18:00:00.000Z'));

  it('depósito de marzo repartido en mayo: el pago es de marzo y su mes ya cerró', async () => {
    const dep = await nuevoDeposito(120_000, MARZO);
    const a = await nuevoEvento(banqueteroId);

    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: a.id, monto: 55_000 }] },
      actor,
    );
    const pago = await prisma.payment.findUniqueOrThrow({ where: { id: pagos[0]!.paymentId } });

    // La fecha es la del depósito, no la del reparto (que es hoy, agosto de 2026).
    expect(pago.fecha.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(pago.createdAt.getUTCMonth()).not.toBe(pago.fecha.getUTCMonth());

    // Y por lo tanto el candado lo trata como ingreso de MARZO: al 20 de mayo su
    // mes ya cerró y se fue a la global de público en general.
    const estado = estadoFacturaPago(pago, MAYO);
    expect(estado.facturable).toBe(false);
    expect(estado.motivo).toBe('Cerró marzo sin CFDI: este pago se facturó a público en general.');
  });

  it('control: con la fecha del REPARTO el mismo pago se vería facturable, y sería el bug', async () => {
    // Si el pago hubiera nacido con la fecha del reparto (mayo), al 20 de mayo el
    // candado lo dejaría timbrar — fuera del mes en que el dinero entró. Este
    // control es lo que le da dientes a la aserción de arriba.
    const comoSiFueraDeMayo = { fecha: new Date('2026-05-20T00:00:00.000Z'), anuladoAt: null };
    expect(estadoFacturaPago(comoSiFueraDeMayo, MAYO).facturable).toBe(true);
  });

  it('el pago hereda también el método, la referencia y el comprobante del depósito', async () => {
    const dep = await registrarDeposito(
      prisma,
      storage,
      banqueteroId,
      { monto: 60_000, metodo: 'efectivo', fecha: MARZO, referencia: 'ficha 4412' },
      actor,
      { data: Buffer.from('ficha-del-banco'), mime: 'image/jpeg' },
    );
    const a = await nuevoEvento(banqueteroId);
    const { pagos } = await asignarDeposito(
      prisma,
      storage,
      dep.id,
      { asignaciones: [{ quoteId: a.id, monto: 60_000 }] },
      actor,
    );
    const pago = await prisma.payment.findUniqueOrThrow({ where: { id: pagos[0]!.paymentId } });
    expect(pago.metodo).toBe('efectivo');
    expect(pago.referencia).toBe('ficha 4412');
    // Un solo movimiento bancario detrás de los recibos: el mismo comprobante.
    expect(pago.comprobanteKey).toBe(dep.comprobanteKey);
  });
});
