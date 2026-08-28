import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { ServerStorage } from '../payments/storage.js';
import type { Actor } from '../quotes/service.js';
import { registrarDeposito, asignarDeposito, saldoSinAsignar } from './cuenta.js';
import { crearApartado, convertirApartado, listarApartados, cancelarApartado } from './apartados.js';
import { anularAbono, registrarAbono, totalAbonado } from './abonos.js';

/**
 * Abonar a una fecha apartada.
 *
 * El caso del dueño, en sus palabras: "quiero una fecha del 2029, tú todavía no
 * tienes precios... voy poco a poco abonando durante el 2027 y en el 2028 puedo
 * hasta liquidarlo pero seguir sin muchas cosas claras".
 *
 * Lo que se fija aquí: que se pueda abonar muchas veces, desde las dos fuentes
 * (pago directo y saldo del banquetero), sin cliente, sin PAX y sin precio — y
 * que al convertir, CADA abono conserve la fecha en que entró.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-abonos-test-' + randomUUID()));

let actor: Actor;
let ventas: Actor;
let arcosId: string;
let camposId: string;
let eventTypeId: string;
let banqueteroId: string;
const banqueteros: string[] = [];
const quotes: string[] = [];
const clients: string[] = [];

/** Fechas de 2039: lejos de las demás suites y de cualquier "hoy". */
let seq = 0;
function fechaLejana(): string {
  const d = new Date(Date.UTC(2039, 0, 1));
  d.setUTCDate(d.getUTCDate() + 7 * seq++);
  return d.toISOString().slice(0, 10);
}
const VENCE = '2038-12-01';

async function nuevoBanquetero(nombre: string): Promise<string> {
  const b = await prisma.banquetero.create({
    data: { nombre: `${nombre} ${randomUUID().slice(0, 6)}`, telefono: '55 0000 0000' },
  });
  banqueteros.push(b.id);
  return b.id;
}

async function nuevoApartado(over: Record<string, unknown> = {}) {
  const { apartado } = await crearApartado(
    prisma,
    (over.banqueteroId as string) ?? banqueteroId,
    { fechaEvento: fechaLejana(), spaceIds: [arcosId], vence: VENCE, ...over },
    actor,
  );
  return apartado;
}

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  actor = { id: admin.id, role: 'admin' };
  ventas = { id: admin.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } })).id;
  camposId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Jardín Los Campos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  banqueteroId = await nuevoBanquetero('Abonos');
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
});

describe('una fecha se abona de a poco', () => {
  it('acepta varios abonos con sus propias fechas, sin cliente ni PAX ni precio', async () => {
    // Solo fecha y salón: es todo lo que el banquetero tiene en 2027.
    const apartado = await nuevoApartado();

    await registrarAbono(
      prisma, storage, apartado.id,
      { monto: 20_000, metodo: 'transferencia', fecha: '2037-03-15' },
      actor,
    );
    await registrarAbono(
      prisma, storage, apartado.id,
      { monto: 30_000, metodo: 'efectivo', fecha: '2037-09-02' },
      actor,
    );
    await registrarAbono(
      prisma, storage, apartado.id,
      { monto: 50_000, metodo: 'transferencia', fecha: '2038-01-20' },
      actor,
    );

    const [visto] = await listarApartados(prisma, banqueteroId);
    const mio = (await listarApartados(prisma, banqueteroId)).find((a) => a.id === apartado.id)!;
    expect(visto).toBeDefined();
    expect(mio.abonado).toBe(100_000);
    expect(mio.abonos).toHaveLength(3);
    // Cada uno conserva SU fecha: son tres ingresos de tres meses distintos.
    expect(mio.abonos.map((a) => a.fecha.toISOString().slice(0, 10))).toEqual([
      '2037-03-15',
      '2037-09-02',
      '2038-01-20',
    ]);
  });

  it('anular un abono lo saca del acumulado', async () => {
    const apartado = await nuevoApartado();
    const uno = await registrarAbono(
      prisma, storage, apartado.id,
      { monto: 40_000, metodo: 'efectivo', fecha: '2037-05-05' },
      actor,
    );
    await registrarAbono(
      prisma, storage, apartado.id,
      { monto: 10_000, metodo: 'efectivo', fecha: '2037-06-05' },
      actor,
    );

    await anularAbono(prisma, uno.id, { motivo: 'el cheque rebotó' }, actor);

    const mio = (await listarApartados(prisma, banqueteroId)).find((a) => a.id === apartado.id)!;
    expect(mio.abonado).toBe(10_000);
  });

  it('no deja abonar a una fecha cancelada ni a una ya convertida', async () => {
    const cancelado = await nuevoApartado();
    await cancelarApartado(prisma, cancelado.id, { motivo: 'ya no la quiso' }, actor);
    await expect(
      registrarAbono(prisma, storage, cancelado.id, { monto: 1000, metodo: 'efectivo', fecha: '2037-01-01' }, actor),
    ).rejects.toMatchObject({ status: 409 });

    const convertido = await nuevoApartado();
    const { quote } = await convertirApartado(
      prisma, storage, convertido.id,
      { eventTypeId, invitados: 200 },
      actor,
    );
    quotes.push(quote.id);
    clients.push(quote.clientId);
    await expect(
      registrarAbono(prisma, storage, convertido.id, { monto: 1000, metodo: 'efectivo', fecha: '2037-01-01' }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('registrar un abono es de admin', async () => {
    const apartado = await nuevoApartado();
    await expect(
      registrarAbono(prisma, storage, apartado.id, { monto: 1000, metodo: 'efectivo', fecha: '2037-01-01' }, ventas),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('abonar desde el saldo del banquetero', () => {
  it('el reparto de un depósito puede ir a una fecha apartada, y baja su saldo', async () => {
    const banq = await nuevoBanquetero('Reparto a fecha');
    const apartado = await nuevoApartado({ banqueteroId: banq, spaceIds: [camposId] });

    const deposito = await registrarDeposito(
      prisma, storage, banq,
      { monto: 300_000, metodo: 'transferencia', fecha: '2037-02-10' },
      actor,
    );
    expect(deposito.saldoSinAsignar).toBe(300_000);

    const res = await asignarDeposito(
      prisma, storage, deposito.id,
      { apartados: [{ apartadoId: apartado.id, monto: 120_000 }] },
      actor,
    );

    expect(res.abonos).toHaveLength(1);
    // El saldo baja: el dinero ya tiene destino aunque ese destino no tenga precio.
    expect(res.deposito.saldoSinAsignar).toBe(180_000);

    const mio = (await listarApartados(prisma, banq)).find((a) => a.id === apartado.id)!;
    expect(mio.abonado).toBe(120_000);
    // Hereda la fecha del DEPÓSITO, no la de hoy: el ingreso se factura en el mes
    // en que se recibió.
    expect(mio.abonos[0]!.fecha.toISOString().slice(0, 10)).toBe('2037-02-10');
  });

  it('no se puede repartir más del saldo, contando los abonos', async () => {
    const banq = await nuevoBanquetero('Sin saldo');
    const apartado = await nuevoApartado({ banqueteroId: banq, spaceIds: [camposId] });
    const deposito = await registrarDeposito(
      prisma, storage, banq,
      { monto: 50_000, metodo: 'efectivo', fecha: '2037-02-10' },
      actor,
    );
    await asignarDeposito(prisma, storage, deposito.id, { apartados: [{ apartadoId: apartado.id, monto: 40_000 }] }, actor);

    await expect(
      asignarDeposito(prisma, storage, deposito.id, { apartados: [{ apartadoId: apartado.id, monto: 20_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('anular el abono devuelve el dinero al saldo sin asignar', async () => {
    const banq = await nuevoBanquetero('Devolución');
    const apartado = await nuevoApartado({ banqueteroId: banq, spaceIds: [camposId] });
    const deposito = await registrarDeposito(
      prisma, storage, banq,
      { monto: 80_000, metodo: 'efectivo', fecha: '2037-02-10' },
      actor,
    );
    const res = await asignarDeposito(
      prisma, storage, deposito.id,
      { apartados: [{ apartadoId: apartado.id, monto: 80_000 }] },
      actor,
    );
    expect(res.deposito.saldoSinAsignar).toBe(0);

    await anularAbono(prisma, res.abonos[0]!.abonoId, { motivo: 'iba a otra fecha' }, actor);

    const recargado = await prisma.pagoBanquetero.findUniqueOrThrow({
      where: { id: deposito.id },
      include: { asignaciones: true, abonosApartado: true },
    });
    expect(saldoSinAsignar(recargado, recargado.asignaciones, recargado.abonosApartado)).toBe(80_000);
  });

  it('un depósito no puede abonar la fecha de otro banquetero', async () => {
    const banq = await nuevoBanquetero('Dueño del dinero');
    const otro = await nuevoBanquetero('Dueño de la fecha');
    const apartadoAjeno = await nuevoApartado({ banqueteroId: otro, spaceIds: [camposId] });
    const deposito = await registrarDeposito(
      prisma, storage, banq,
      { monto: 10_000, metodo: 'efectivo', fecha: '2037-02-10' },
      actor,
    );

    await expect(
      asignarDeposito(prisma, storage, deposito.id, { apartados: [{ apartadoId: apartadoAjeno.id, monto: 5_000 }] }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('al convertir la fecha en cotización', () => {
  it('cada abono se vuelve un pago CON SU PROPIA FECHA', async () => {
    const apartado = await nuevoApartado();
    await registrarAbono(prisma, storage, apartado.id, { monto: 20_000, metodo: 'transferencia', fecha: '2037-03-15' }, actor);
    await registrarAbono(prisma, storage, apartado.id, { monto: 30_000, metodo: 'efectivo', fecha: '2038-01-20' }, actor);

    const { quote } = await convertirApartado(prisma, storage, apartado.id, { eventTypeId, invitados: 200 }, actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    const pagos = await prisma.payment.findMany({ where: { quoteId: quote.id }, orderBy: { fecha: 'asc' } });
    // DOS pagos, no uno por la suma: son dos ingresos de dos meses distintos y el
    // SAT exige facturar cada uno en el suyo.
    expect(pagos).toHaveLength(2);
    expect(pagos.map((p) => p.fecha.toISOString().slice(0, 10))).toEqual(['2037-03-15', '2038-01-20']);
    expect(pagos.reduce((s, p) => s + p.monto, 0)).toBe(50_000);
    // Y cada uno con su folio de recibo, como cualquier pago.
    expect(pagos.every((p) => p.folio > 0)).toBe(true);
  });

  it('un abono anulado NO se convierte en pago', async () => {
    const apartado = await nuevoApartado();
    const vivo = await registrarAbono(prisma, storage, apartado.id, { monto: 15_000, metodo: 'efectivo', fecha: '2037-04-01' }, actor);
    const muerto = await registrarAbono(prisma, storage, apartado.id, { monto: 99_000, metodo: 'efectivo', fecha: '2037-04-02' }, actor);
    await anularAbono(prisma, muerto.id, { motivo: 'capturado dos veces' }, actor);

    const { quote } = await convertirApartado(prisma, storage, apartado.id, { eventTypeId, invitados: 200 }, actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    const pagos = await prisma.payment.findMany({ where: { quoteId: quote.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.monto).toBe(15_000);
    expect((await prisma.abonoApartado.findUniqueOrThrow({ where: { id: vivo.id } })).paymentId).toBe(
      pagos[0]!.id,
    );
  });

  it('el dinero del depósito no se cuenta dos veces al convertir', async () => {
    // Es la trampa del diseño: el abono se vuelve `Payment`, y si los dos
    // siguieran contando contra el depósito, su saldo saldría corto para siempre.
    const banq = await nuevoBanquetero('Sin doble conteo');
    const apartado = await nuevoApartado({ banqueteroId: banq, spaceIds: [camposId] });
    const deposito = await registrarDeposito(
      prisma, storage, banq,
      { monto: 100_000, metodo: 'transferencia', fecha: '2037-02-10' },
      actor,
    );
    await asignarDeposito(prisma, storage, deposito.id, { apartados: [{ apartadoId: apartado.id, monto: 60_000 }] }, actor);

    const { quote } = await convertirApartado(prisma, storage, apartado.id, { eventTypeId, invitados: 200 }, actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    const recargado = await prisma.pagoBanquetero.findUniqueOrThrow({
      where: { id: deposito.id },
      include: { asignaciones: true, abonosApartado: true },
    });
    // 100,000 − 60,000 = 40,000. Ni 100,000 (sin contar nada) ni −20,000 (contando
    // el abono Y su pago).
    expect(saldoSinAsignar(recargado, recargado.asignaciones, recargado.abonosApartado)).toBe(40_000);
    // Y el pago conserva la liga al depósito: el rastro del dinero no se corta.
    const pago = await prisma.payment.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(pago.pagoBanqueteroId).toBe(deposito.id);
  });

  it('un abono ya convertido no se puede anular desde el apartado', async () => {
    const apartado = await nuevoApartado();
    const abono = await registrarAbono(prisma, storage, apartado.id, { monto: 5_000, metodo: 'efectivo', fecha: '2037-07-07' }, actor);
    const { quote } = await convertirApartado(prisma, storage, apartado.id, { eventTypeId, invitados: 200 }, actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    // Anularlo aquí dejaría vivo su `Payment`: la corrección va por el pago.
    await expect(anularAbono(prisma, abono.id, { motivo: 'me equivoqué' }, actor)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('el acumulado (puro)', () => {
  it('suma los vivos e ignora los anulados', () => {
    expect(
      totalAbonado([
        { monto: 100, anuladoAt: null },
        { monto: 50, anuladoAt: new Date() },
        { monto: 25, anuladoAt: null },
      ]),
    ).toBe(125);
  });
});
