import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hsa/database';
import { createQuote, updateQuote, seleccionGuardada, type Actor } from './service.js';

/**
 * "Teléfono o correo tienen que ser obligatorio, tiene que tener al menos 1" (el
 * dueño). Lo que se protege: que no se dé de alta un cliente al que no se le
 * puede avisar nada, y que uno viejo sin contacto lo complete al editarse.
 */

let admin: Actor;
let arcosId: string;
let eventTypeId: string;
const quotes: string[] = [];
const clients: string[] = [];

let semana = 0;
const fecha = () => {
  const d = new Date(Date.UTC(2048, 0, 4 + 7 * semana++));
  return d.toISOString().slice(0, 10);
};
const evento = (extra: Record<string, unknown>) => ({
  fecha: fecha(),
  invitados: 200,
  spaceIds: [arcosId],
  eventTypeId,
  ...extra,
});

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
});

async function crear(extra: Record<string, unknown>) {
  const q = await createQuote(prisma, evento(extra), admin);
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

describe('teléfono o correo obligatorio', () => {
  it('sin ninguno de los dos no se crea, y no deja cliente huérfano', async () => {
    const antes = await prisma.client.count({ where: { nombre: 'Sin Contacto 2048' } });
    await expect(crear({ client: { nombre: 'Sin Contacto 2048' } })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.client.count({ where: { nombre: 'Sin Contacto 2048' } })).toBe(antes);
  });

  it('con solo teléfono o solo correo, sí', async () => {
    await expect(crear({ client: { nombre: 'Solo Tel 2048', telefono: '55 1234 5678' } })).resolves.toBeTruthy();
    await expect(crear({ client: { nombre: 'Solo Correo 2048', correo: 'ana@ejemplo.com' } })).resolves.toBeTruthy();
  });

  it('un teléfono de relleno no cuenta', async () => {
    await expect(crear({ client: { nombre: 'Tel Falso 2048', telefono: '123' } })).rejects.toMatchObject({ status: 400 });
  });

  it('un cliente viejo sin contacto: reutilizarlo exige completarlo, y completarlo lo guarda en su ficha', async () => {
    const viejo = await prisma.client.create({ data: { nombre: 'Viejo Sin Contacto 2048' } });
    clients.push(viejo.id);
    await expect(crear({ clientId: viejo.id })).rejects.toMatchObject({ status: 400 });
    await crear({ clientId: viejo.id, client: { nombre: viejo.nombre, correo: 'viejo@ejemplo.com' } });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: viejo.id } })).correo).toBe('viejo@ejemplo.com');
  });

  it('editar el evento con el cliente: debe quedar con contacto; moverlo sin tocar al cliente, no tropieza', async () => {
    const q = await crear({ client: { nombre: 'Edita 2048', telefono: '5512345678' } });
    // El cliente pierde su contacto por fuera (dato viejo).
    await prisma.client.update({ where: { id: q.clientId }, data: { telefono: null } });
    const completo = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: { extras: true } });
    const sel = seleccionGuardada(completo);
    await expect(
      updateQuote(prisma, q.id, { ...sel, eventTypeId, client: { nombre: 'Edita 2048' } }, admin),
    ).rejects.toMatchObject({ status: 400 });
    await expect(updateQuote(prisma, q.id, { ...sel, eventTypeId }, admin)).resolves.toBeTruthy();
  });
});
