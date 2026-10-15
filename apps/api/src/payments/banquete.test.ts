import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { restarDinero } from '@hsa/shared';
import { createQuote, getByToken, getQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from './storage.js';
import { registerPayment, anularPayment } from './service.js';
import { corregirPago } from './correcciones.js';
import { cuentaBanquete } from './banquete.js';

/**
 * "Abajo de la sección de Registrar Pago necesitamos otra sección idéntica... que
 * diga Registrar Pago Banquete" (Jorge, 15-oct-2026). Decisión de Fernando: ese
 * dinero lo cobra la hacienda — folio I, recibo y saldo contra los alimentos —,
 * pero no toca la renta, el plan de pagos ni el estatus del evento.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-banquete-test-' + randomUUID()));
let admin: Actor;
let arcosId: string;
let eventTypeId: string;
let paqueteId: string;
const quotes: string[] = [];
const clients: string[] = [];

let semana = 0;
/** Sábados de 2053, uno por llamada. */
const sabado = () => new Date(Date.UTC(2053, 0, 4 + 7 * semana++)).toISOString().slice(0, 10);

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  paqueteId = (
    await prisma.foodPackage.findFirstOrThrow({ where: { nombre: 'SUPREME', eventTypeId, priceList: { activa: true } } })
  ).id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.correoCliente.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

async function evento(conAlimentos = true) {
  const q = await createQuote(
    prisma,
    {
      fecha: sabado(),
      invitados: 200,
      spaceIds: [arcosId],
      eventTypeId,
      ...(conAlimentos ? { foodPackageId: paqueteId } : {}),
      client: { nombre: 'Banquete Test', telefono: '5512345678', correo: 'banquete@example.com' },
    },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

const pagarBanquete = (id: string, monto: number) =>
  registerPayment(prisma, storage, id, { monto, metodo: 'transferencia', fecha: '2026-10-15', destino: 'banquete' }, admin);

describe('pago del banquete', () => {
  it('lleva folio y abona al banquete sin tocar la renta, el plan ni el estatus', async () => {
    const q = await evento();
    const totalBanquete = restarDinero(q.total, q.rentaTotal);
    expect(totalBanquete).toBeGreaterThan(0);

    const { payment, nuevoEstatus, estadoCuenta } = await pagarBanquete(q.id, 50_000.5);
    expect(payment.folio).toBeGreaterThan(0);
    expect(payment.destino).toBe('banquete');
    expect(payment.concepto).toBe('anticipo');
    expect(nuevoEstatus).toBeNull();
    expect(estadoCuenta.pagado).toBe(0); // la renta no se entera

    const actual = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(actual.status).toBe('borrador');
    const cuenta = await cuentaBanquete(prisma, actual);
    expect(cuenta).toMatchObject({ total: totalBanquete, pagado: 50_000.5, saldo: restarDinero(totalBanquete, 50_000.5) });
  });

  it('el pago que lo completa es finiquito; los de en medio, a cuenta; y no deja pasarse', async () => {
    const q = await evento();
    const total = restarDinero(q.total, q.rentaTotal);
    await pagarBanquete(q.id, 1_000);
    const enMedio = await pagarBanquete(q.id, 2_000);
    expect(enMedio.payment.concepto).toBe('aCuenta');

    await expect(pagarBanquete(q.id, restarDinero(total, 2_999))).rejects.toMatchObject({ status: 409 });
    const cierre = await pagarBanquete(q.id, restarDinero(total, 3_000));
    expect(cierre.payment.concepto).toBe('finiquito');
    await expect(pagarBanquete(q.id, 1)).rejects.toThrow(/pagado completo/);
  });

  it('un evento sin alimentos no tiene banquete que cobrar', async () => {
    const q = await evento(false);
    await expect(pagarBanquete(q.id, 1_000)).rejects.toThrow(/no hay banquete/);
  });

  it('el detalle y la vista del cliente traen la cuenta del banquete con sus recibos', async () => {
    const q = await evento();
    const { payment } = await pagarBanquete(q.id, 5_000);
    const detalle = await getQuote(prisma, q.id, admin);
    expect(detalle!.banquete.pagos.map((p) => p.id)).toEqual([payment.id]);
    expect(detalle!.payments.some((p) => p.id === payment.id)).toBe(false); // no se mezcla con la renta

    const publico = await getByToken(prisma, q.publicToken);
    expect(publico!.banquete.pagos.map((p) => p.id)).toEqual([payment.id]);
    expect(publico!.banquete.pagado).toBe(5_000);
  });

  it('anular le regresa el saldo; corregir el monto no deja pasarse del total', async () => {
    const q = await evento();
    const total = restarDinero(q.total, q.rentaTotal);
    const { payment } = await pagarBanquete(q.id, 10_000);
    await expect(
      corregirPago(prisma, q.id, payment.id, { monto: total + 1, motivo: 'Prueba de tope' }, admin),
    ).rejects.toMatchObject({ status: 409 });

    await anularPayment(prisma, q.id, payment.id, 'Capturado de más', admin);
    const cuenta = await cuentaBanquete(prisma, q);
    expect(cuenta.pagado).toBe(0);
    expect(cuenta.saldo).toBe(total);
  });
});
