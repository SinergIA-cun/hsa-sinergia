import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, getQuote, updateQuote, seleccionGuardada, simularFecha, type Actor } from './service.js';
import { cancelarEvento, eventosSinFecha, ponerEnStandby, reprogramarEvento } from './ciclo.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment } from '../payments/service.js';
import { devolverACliente } from '../devoluciones/service.js';
import { getAvailability, getAgenda } from '../availability/service.js';
import { biEventos } from '../bi/service.js';

/**
 * "Un evento debe poderse cancelar, poner en standby, o mover de fecha de manera
 * sencilla. Si se cancela debe dar las opciones de qué hacer con el dinero... Si
 * se pone en standby en alguna parte deben quedar ese evento que ahora no tiene
 * fecha" (el dueño, 1-oct-2026).
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-ciclo-test-' + randomUUID()));
let admin: Actor;
let ventas: Actor;
let arcosId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

let semana = 0;
/** Sábados de 2051, uno por llamada. */
const sabado = () => new Date(Date.UTC(2051, 0, 7 + 7 * semana++)).toISOString().slice(0, 10);
/** El martes de la misma semana que un sábado. */
const martesAntes = (sab: string) => {
  const d = new Date(`${sab}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 4);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  ventas = { id: u.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  await prisma.devolucion.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

async function evento(fecha = sabado()) {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ciclo Test', telefono: '5512345678' } },
    admin,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

const pagar = (id: string, monto: number) =>
  registerPayment(prisma, storage, id, { monto, metodo: 'transferencia', fecha: '2026-10-01' }, admin);

const nivel = async (fecha: string) => (await getAvailability(prisma, fecha, [arcosId])).spaces[0]!.level;

describe('standby: el evento sin fecha', () => {
  it('suelta la fecha, queda en la lista "sin fecha" y no se edita por el camino normal', async () => {
    const q = await evento();
    const fecha = q.fechaEvento.toISOString().slice(0, 10);
    await pagar(q.id, 20_000); // aparta: formalizada, bloquea
    expect(await nivel(fecha)).toBe('bloqueada');

    await ponerEnStandby(prisma, q.id, { motivo: 'El novio se fue de viaje' }, admin);
    expect(await nivel(fecha)).toBe('libre');
    const agenda = await getAgenda(prisma, fecha, fecha);
    expect(agenda.events.some((e) => e.quoteId === q.id)).toBe(false);
    const sinFecha = await eventosSinFecha(prisma, admin);
    expect(sinFecha.find((e) => e.quoteId === q.id)).toMatchObject({ statusPrevio: 'formalizada', motivo: 'El novio se fue de viaje' });

    const sel = seleccionGuardada(await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: { extras: true } }));
    await expect(updateQuote(prisma, q.id, sel, admin)).rejects.toMatchObject({ status: 409 });
  });

  it('un pago en standby se registra pero no lo regresa a la agenda', async () => {
    const q = await evento();
    await pagar(q.id, 20_000);
    await ponerEnStandby(prisma, q.id, { motivo: 'Pospuesto' }, admin);
    await pagar(q.id, 30_000);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('standby');
  });

  it('reprogramar: fecha nueva, vuelve a su estatus, sube si los pagos ya dan, y el código cambia con rastro', async () => {
    const q = await evento();
    await pagar(q.id, 20_000);
    await ponerEnStandby(prisma, q.id, { motivo: 'Pospuesto' }, admin);
    // Mientras estaba sin fecha pagó el complemento.
    await pagar(q.id, 30_000);
    const nueva = sabado();
    const r = await reprogramarEvento(prisma, q.id, { fecha: nueva }, admin);
    expect(r.fechaEvento.toISOString().slice(0, 10)).toBe(nueva);
    expect(r.status).toBe('complementada');
    expect(r.standbyDesde).toBeNull();
    expect(r.etiqueta).not.toBe(q.etiqueta);
    const codigos = await prisma.codigoEvento.findMany({ where: { quoteId: q.id }, orderBy: { createdAt: 'asc' } });
    expect(codigos.map((c) => c.codigo)).toEqual([q.etiqueta, r.etiqueta]);
    expect(await nivel(nueva)).toBe('bloqueada');
  });

  it('reprogramar a una fecha ocupada falla y el evento se queda en standby', async () => {
    const otro = await evento();
    await pagar(otro.id, 20_000);
    const ocupada = otro.fechaEvento.toISOString().slice(0, 10);
    const q = await evento();
    await ponerEnStandby(prisma, q.id, { motivo: 'Pospuesto' }, admin);
    await expect(reprogramarEvento(prisma, q.id, { fecha: ocupada }, admin)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('standby');
  });
});

describe('mover de fecha', () => {
  it('la vista previa da el precio nuevo; respetar el precio pactado no lo recotiza', async () => {
    const sab = sabado();
    const q = await evento(sab);
    const martes = martesAntes(sab);
    const previa = await simularFecha(prisma, q.id, martes, admin);
    expect(previa.antes).toBe(q.total);
    expect(previa.despues).not.toBe(q.total); // sábado → martes cambia la renta
    expect(previa.ocupados).toEqual([]);

    const conservado = await reprogramarEvento(prisma, q.id, { fecha: martes, conservarPrecio: true }, admin);
    expect(conservado.total).toBe(q.total);
    expect(conservado.fechaEvento.toISOString().slice(0, 10)).toBe(martes);

    const recotizado = await reprogramarEvento(prisma, q.id, { fecha: sabado() }, admin);
    expect(recotizado.total).toBe(previa.antes); // de vuelta a sábado, precio de sábado
  });
});

describe('cancelar: qué pasa con el dinero', () => {
  it('100% con la devolución en el momento: nada pendiente y la fecha queda libre', async () => {
    const q = await evento();
    const fecha = q.fechaEvento.toISOString().slice(0, 10);
    await pagar(q.id, 25_000);
    const r = await cancelarEvento(
      prisma,
      q.id,
      { motivo: 'Cambio de planes', porcentaje: 100, devolucion: { metodo: 'transferencia', fecha: '2026-10-02' } },
      admin,
    );
    expect(r.cancelacion).toEqual({ pagado: 25_000, porcentaje: 100, devolver: 25_000, retenido: 0 });
    expect(r.devolucion?.monto).toBe(25_000);
    expect(await nivel(fecha)).toBe('libre');
    const detalle = await getQuote(prisma, q.id, admin);
    expect(detalle!.cancelacion).toMatchObject({ devolver: 25_000, devuelto: 25_000, pendiente: 0 });
  });

  it('50% sin devolver todavía: queda pendiente, y al devolver después se salda', async () => {
    const q = await evento();
    await pagar(q.id, 40_000);
    await cancelarEvento(prisma, q.id, { motivo: 'Penalización del 50%', porcentaje: 50 }, admin);
    expect((await getQuote(prisma, q.id, admin))!.cancelacion).toMatchObject({
      pagado: 40_000, devolver: 20_000, retenido: 20_000, devuelto: 0, pendiente: 20_000,
    });
    await devolverACliente(prisma, q.id, { monto: 20_000, metodo: 'efectivo', fecha: '2026-10-05', motivo: 'Cancelación' }, admin);
    expect((await getQuote(prisma, q.id, admin))!.cancelacion).toMatchObject({ devuelto: 20_000, pendiente: 0 });
  });

  it('con pagos solo cancela un admin; sin pagos, quien lo hizo', async () => {
    const conPago = await evento();
    await pagar(conPago.id, 20_000);
    await expect(cancelarEvento(prisma, conPago.id, { motivo: 'Se cae', porcentaje: 0 }, ventas)).rejects.toMatchObject({ status: 403 });
    const sinPago = await evento();
    await expect(cancelarEvento(prisma, sinPago.id, { motivo: 'Se cae', porcentaje: 0 }, ventas)).resolves.toBeTruthy();
  });

  it('a un cancelado ya no le entran pagos; un admin lo reactiva y vuelve a su estatus', async () => {
    const q = await evento();
    await pagar(q.id, 20_000);
    await cancelarEvento(prisma, q.id, { motivo: 'Se cae', porcentaje: 0 }, admin);
    await expect(pagar(q.id, 1_000)).rejects.toMatchObject({ status: 409 });
    const fecha = q.fechaEvento.toISOString().slice(0, 10);
    await expect(reprogramarEvento(prisma, q.id, { fecha }, ventas)).rejects.toMatchObject({ status: 403 });
    const r = await reprogramarEvento(prisma, q.id, { fecha }, admin);
    expect(r.status).toBe('formalizada');
    expect(r.canceladaAt).toBeNull();
  });

  it('un porcentaje fuera de 0..100 se rechaza', async () => {
    const q = await evento();
    await expect(cancelarEvento(prisma, q.id, { motivo: 'Se cae', porcentaje: 120 }, admin)).rejects.toThrow();
  });

  it('el BI recibe la cancelación con lo devuelto y lo pendiente', async () => {
    const q = await evento();
    await pagar(q.id, 30_000);
    await cancelarEvento(prisma, q.id, { motivo: 'Se cae', porcentaje: 50 }, admin);
    const dia = q.fechaEvento;
    const fila = (await biEventos(prisma, { desde: dia, hasta: dia, limit: 500 })).find((f) => f.id === q.id)!;
    expect(fila.estatus).toBe('cancelada');
    expect(fila.cancelacion).toMatchObject({ porcentaje: 50, pagado: 30_000, devolver: 15_000, retenido: 15_000, pendiente: 15_000 });
  });
});
