import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, getQuote, getByToken, loadEstadoCuenta, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment, anularPayment } from '../payments/service.js';
import { registrarCargo, anularCargo, cuentaDelEvento, productosDelEvento } from './service.js';
import { biCargos, biEventos, biPagos } from '../bi/service.js';
import { clonarCatalogo } from '../pricelists/service.js';
import { editarParametros } from '../pricelists/editar.js';
import { borrarCatalogoDePrueba } from '../pricelists/testSupport.js';

/**
 * El punto de venta del evento. La regla que se protege es la del dueño: lo que
 * se carga después de contratar "no debe aumentar el valor del evento, pero sí
 * debe registrar los pagos casados a ese evento y reportarlo al BI".
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-cargos-test-' + randomUUID()));

let app: FastifyInstance;
let admin: Actor;
let ventas: Actor;
let arcosId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];
const ventasEmail = `ventas-cargos-${randomUUID()}@haciendasanandres.com.mx`;

const PRIMER_SABADO = '2042-01-04';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function nuevoEvento(formalizar = true) {
  const q = await createQuote(
    prisma,
    { fecha: siguienteSabado(), invitados: 250, spaceIds: [arcosId], eventTypeId, client: { telefono: '5555550000', nombre: 'Punto de Venta Test' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  if (formalizar) {
    // El anticipo de Arcos formaliza el evento solo.
    await registerPayment(prisma, storage, q.id, { monto: 20_000, metodo: 'transferencia', fecha: '2026-09-15' }, admin);
  }
  return prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  const v = await prisma.user.create({
    data: { nombre: 'Ventas PV', email: ventasEmail, passwordHash: await hashPassword('ventas1234'), role: 'ventas' },
  });
  ventas = { id: v.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  await prisma.cargoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.user.delete({ where: { id: ventas.id } });
  await app.close();
});

describe('cargos a la cuenta del evento', () => {
  it('un borrador no tiene cuenta: cargarle algo es 409', async () => {
    const q = await nuevoEvento(false);
    await expect(
      registrarCargo(prisma, q.id, { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_000, fecha: '2026-10-01' }, admin),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('sugiere la hora extra al 5% de la renta firmada y el DJ del catálogo', async () => {
    const q = await nuevoEvento();
    const productos = await productosDelEvento(prisma, q);
    const hora = productos.find((p) => p.producto === 'horaExtra')!;
    // Arcos, 250 invitados, sábado: $108,500 de renta → $5,425 la hora.
    expect(q.rentaTotal).toBe(108_500);
    expect(hora.precioSugerido).toBe(5_425);
    const dj = productos.find((p) => p.producto === 'djHoraExtra');
    expect(dj?.precioSugerido).toBe(2_950);
    expect(productos.find((p) => p.producto === 'multa')!.precioSugerido).toBeNull();
    // Invitados extra: la renta de una persona en su nivel. 250 en Arcos sábado
    // cae en 201–300 → $108,500 / 300.
    expect(productos.find((p) => p.producto === 'invitadoExtra')!.precioSugerido).toBe(Math.round(108_500 / 300));
    // Sin paquete de alimentos no se ofrecen los alimentos de los invitados extra.
    expect(productos.some((p) => p.producto === 'invitadoExtraAlimentos')).toBe(false);
  });

  it('el tope de personas extra viaja al clonar el catálogo y se edita como parámetro', async () => {
    const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const clon = await clonarCatalogo(prisma, { nombre: `Extras ${randomUUID().slice(0, 6)}`, anio: 2099, clonarDe: activo.id });
    try {
      const editado = await editarParametros(prisma, clon.id, { toleranciaExtras: 20 }, admin);
      expect(editado.toleranciaExtras).toBe(20);
      const otro = await clonarCatalogo(prisma, { nombre: `Extras2 ${randomUUID().slice(0, 6)}`, anio: 2099, clonarDe: clon.id });
      expect(otro.toleranciaExtras).toBe(20);
      await borrarCatalogoDePrueba(prisma, otro.id);
      await expect(editarParametros(prisma, clon.id, { toleranciaExtras: 2.5 }, admin)).rejects.toBeTruthy();
    } finally {
      await borrarCatalogoDePrueba(prisma, clon.id);
    }
  });

  it('dos horas extra NO cambian el valor del evento ni su plan de pagos', async () => {
    const q = await nuevoEvento();
    const antes = await loadEstadoCuenta(prisma, q);
    const { cargo, cuenta } = await registrarCargo(
      prisma, q.id, { producto: 'horaExtra', cantidad: 2, precioUnitario: 5_425, fecha: '2026-10-01' }, admin,
    );
    expect(cargo.total).toBe(10_850);
    expect(cargo.descripcion).toBe('Hora extra de salón');
    expect(cuenta).toMatchObject({ total: 10_850, pagado: 0, saldo: 10_850 });

    const despues = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(despues.total).toBe(q.total);
    expect(despues.rentaTotal).toBe(q.rentaTotal);
    expect(despues.breakdown).toEqual(q.breakdown);
    const ec = await loadEstadoCuenta(prisma, despues);
    expect(ec.estadoCuenta.total).toBe(antes.estadoCuenta.total);
    expect(ec.estadoCuenta.saldo).toBe(antes.estadoCuenta.saldo);
  });

  it('una multa sin descripción no se acepta', async () => {
    const q = await nuevoEvento();
    await expect(
      registrarCargo(prisma, q.id, { producto: 'multa', cantidad: 1, precioUnitario: 10_000, fecha: '2026-10-01' }, admin),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('cobrar la cuenta del evento', () => {
  it('el pago lleva folio, se puede dividir y NO abona a la renta ni mueve el estatus', async () => {
    const q = await nuevoEvento();
    await registrarCargo(
      prisma, q.id,
      { producto: 'invitadoExtra', cantidad: 5, precioUnitario: 1_200, fecha: '2026-10-01' }, admin,
    );
    const ecAntes = await loadEstadoCuenta(prisma, q);
    const { payment, nuevoEstatus } = await registerPayment(
      prisma, storage, q.id,
      {
        monto: 6_000,
        destino: 'cargos',
        formas: [
          { forma: 'tarjetaDebito', monto: 2_000 },
          { forma: 'tarjetaCredito', monto: 4_000 },
        ],
        fecha: '2026-10-02',
      },
      admin,
    );
    expect(payment.destino).toBe('cargos');
    expect(payment.folio).toBeGreaterThan(0);
    expect(payment.metodo).toBe('mixto');
    expect(nuevoEstatus).toBeNull();

    const ecDespues = await loadEstadoCuenta(prisma, q);
    expect(ecDespues.estadoCuenta.pagado).toBe(ecAntes.estadoCuenta.pagado);
    expect(ecDespues.payments.some((p) => p.id === payment.id)).toBe(false);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(q.status);
    expect(await cuentaDelEvento(prisma, q.id)).toMatchObject({ total: 6_000, pagado: 6_000, saldo: 0 });
  });

  it('no se le puede cobrar más de lo que debe', async () => {
    const q = await nuevoEvento();
    await registrarCargo(prisma, q.id, { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_425, fecha: '2026-10-01' }, admin);
    await expect(
      registerPayment(prisma, storage, q.id, { monto: 6_000, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-02' }, admin),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('sin cargos no hay nada que cobrar a la cuenta', async () => {
    const q = await nuevoEvento();
    await expect(
      registerPayment(prisma, storage, q.id, { monto: 1, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-02' }, admin),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('getQuote y la vista pública traen la cuenta aparte del estado de cuenta', async () => {
    const q = await nuevoEvento();
    await registrarCargo(
      prisma, q.id,
      { producto: 'danos', cantidad: 1, precioUnitario: 3_000, descripcion: 'Rompieron una mesa', fecha: '2026-10-01' }, admin,
    );
    await registerPayment(prisma, storage, q.id, { monto: 1_000, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-02' }, admin);
    const interno = await getQuote(prisma, q.id, admin);
    expect(interno!.cuenta).toMatchObject({ total: 3_000, pagado: 1_000, saldo: 2_000 });
    expect(interno!.payments.every((p) => p.destino === 'evento')).toBe(true);

    const publico = await getByToken(prisma, q.publicToken);
    expect(publico!.cuenta.saldo).toBe(2_000);
    expect(publico!.cuenta.cargos[0]).toEqual({
      id: expect.any(String),
      descripcion: 'Rompieron una mesa',
      cantidad: 1,
      precioUnitario: 3_000,
      total: 3_000,
      fecha: '2026-10-01T00:00:00.000Z',
    });
    expect(publico!.estadoCuenta.pagos.every((p) => p.destino === 'evento')).toBe(true);
    expect(publico!.cuenta.pagos).toHaveLength(1);
  });
});

describe('anular un cargo', () => {
  it('solo admin', async () => {
    const q = await nuevoEvento();
    const { cargo } = await registrarCargo(
      prisma, q.id, { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_425, fecha: '2026-10-01' }, admin,
    );
    await expect(anularCargo(prisma, q.id, cargo.id, { motivo: 'error' }, ventas)).rejects.toMatchObject({ status: 403 });
  });

  it('no deja la cuenta sobrepagada: primero se anula el pago', async () => {
    const q = await nuevoEvento();
    const { cargo } = await registrarCargo(
      prisma, q.id, { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_425, fecha: '2026-10-01' }, admin,
    );
    const { payment } = await registerPayment(
      prisma, storage, q.id, { monto: 5_425, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-02' }, admin,
    );
    await expect(anularCargo(prisma, q.id, cargo.id, { motivo: 'se canceló' }, admin)).rejects.toMatchObject({ status: 409 });
    await anularPayment(prisma, q.id, payment.id, 'se devolvió', admin);
    const cuenta = await anularCargo(prisma, q.id, cargo.id, { motivo: 'se canceló' }, admin);
    expect(cuenta).toMatchObject({ total: 0, pagado: 0, saldo: 0 });
    const log = await prisma.activityLog.findMany({ where: { quoteId: q.id, tipo: { in: ['cargo', 'cargoAnulado'] } } });
    // Cuenta registros: un `tipo` sin su ADD VALUE en Postgres falla en silencio.
    expect(log.map((l) => l.tipo).sort()).toEqual(['cargo', 'cargoAnulado']);
  });
});

describe('BI', () => {
  it('/eventos trae la cuenta aparte del total; /cargos cada renglón; /pagos el destino', async () => {
    const q = await nuevoEvento();
    await registrarCargo(prisma, q.id, { producto: 'horaExtra', cantidad: 2, precioUnitario: 5_425, fecha: '2026-10-03' }, admin);
    await registerPayment(prisma, storage, q.id, { monto: 10_850, metodo: 'efectivo', destino: 'cargos', fecha: '2026-10-03' }, admin);

    const dia = q.fechaEvento.toISOString().slice(0, 10);
    const eventos = await biEventos(prisma, {
      desde: new Date(`${dia}T00:00:00Z`), hasta: new Date(`${dia}T23:59:59Z`), limit: 500,
    });
    const ev = eventos.find((e) => e.id === q.id)!;
    expect(ev.total).toBe(q.total);
    expect(ev.cargosAdicionales).toEqual({ total: 10_850, pagado: 10_850, saldo: 0 });

    const rango = { desde: new Date('2026-10-03T00:00:00Z'), hasta: new Date('2026-10-03T23:59:59Z'), limit: 500 };
    const cargos = (await biCargos(prisma, rango)).filter((c) => c.quoteId === q.id);
    expect(cargos).toHaveLength(1);
    expect(cargos[0]).toMatchObject({ producto: 'horaExtra', productoNombre: 'Hora extra de salón', cantidad: 2, total: 10_850 });
    const pagos = (await biPagos(prisma, rango)).filter((p) => p.quoteId === q.id);
    expect(pagos.map((p) => p.destino)).toEqual(['cargos']);
  });

  it('por la ruta: ventas carga, y el cobro va en multipart con destino', async () => {
    const q = await nuevoEvento();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ventasEmail, password: 'ventas1234' } });
    const cookie = login.cookies[0]!;
    const cookies = { [cookie.name]: cookie.value };
    // Ventas solo ve lo suyo: el evento es del admin, así que lo reasignamos.
    await prisma.quote.update({ where: { id: q.id }, data: { createdById: ventas.id } });
    const alta = await app.inject({
      method: 'POST', url: `/api/quotes/${q.id}/cargos`, cookies,
      payload: { producto: 'horaExtra', cantidad: 1, precioUnitario: 5_425, fecha: '2026-10-01' },
    });
    expect(alta.statusCode).toBe(201);
    const cuenta = await app.inject({ method: 'GET', url: `/api/quotes/${q.id}/cuenta`, cookies });
    expect(cuenta.json().cuenta.saldo).toBe(5_425);
  });
});
