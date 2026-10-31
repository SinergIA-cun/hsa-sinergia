import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { createQuote, updateQuote, seleccionGuardada, SELECCION_INCLUDE, loadEstadoCuenta, type Actor } from './service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';

/**
 * Capilla (30-oct-2026): el cobro de capilla es variable en cada evento, y hay
 * eventos que solo rentan la capilla (sin salón, sin plan de pagos: se aparta y
 * se liquida).
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-capilla-test-' + randomUUID()));
let admin: Actor;
let arcosId: string;
let bodaId: string;
const quotes: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  bodaId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
});

afterAll(async () => {
  const qs = await prisma.quote.findMany({ where: { id: { in: quotes } }, select: { clientId: true } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.codigoEvento.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: qs.map((q) => q.clientId) } } });
});

const base = (fecha: string) => ({
  fecha,
  invitados: 100,
  eventTypeId: '',
  client: { nombre: 'Capilla Prueba', tipo: 'persona' as const, telefono: '5513131313' },
});

const lineaCapilla = (b: unknown) =>
  (b as { lines: { concepto: string; monto: number; detalle?: string }[] }).lines.find((l) => l.concepto === 'Capilla');

describe('capilla con cobro variable', () => {
  it('un viernes se cobra lo capturado, y sobrevive a editar sin tocarlo', async () => {
    // 2065-05-01 es viernes: por regla sería cortesía.
    const q = await createQuote(
      prisma,
      { ...base('2065-05-01'), spaceIds: [arcosId], eventTypeId: bodaId, usaCapilla: true, capillaMonto: 1_500 },
      admin,
    );
    quotes.push(q.id);
    expect(q.capillaMonto).toBe(1_500);
    expect(lineaCapilla(q.breakdown)).toMatchObject({ monto: 1_500 });

    // Recalcular desde lo guardado (arrastrar la fecha, mover de catálogo) no lo pierde.
    const guardada = await prisma.quote.findUniqueOrThrow({ where: { id: q.id }, include: SELECCION_INCLUDE });
    const otra = await updateQuote(prisma, q.id, { ...seleccionGuardada(guardada), invitados: 150 }, admin);
    expect(lineaCapilla(otra.breakdown)).toMatchObject({ monto: 1_500 });
  });

  it('sin la capilla no se guarda un cobro de capilla', async () => {
    const q = await createQuote(
      prisma,
      { ...base('2065-05-08'), spaceIds: [arcosId], eventTypeId: bodaId, usaCapilla: false, capillaMonto: 2_000 },
      admin,
    );
    quotes.push(q.id);
    expect(q.capillaMonto).toBeNull();
    expect(lineaCapilla(q.breakdown)).toBeUndefined();
  });
});

describe('solo capilla', () => {
  it('sin salón ni capilla no se puede guardar', async () => {
    await expect(createQuote(prisma, { ...base('2065-05-15'), spaceIds: [], eventTypeId: bodaId }, admin)).rejects.toThrow(
      /capilla sola/,
    );
  });

  it('se aparta con el primer pago y se liquida al cubrir el total, sin plan de pagos', async () => {
    const q = await createQuote(
      prisma,
      { ...base('2065-05-22'), spaceIds: [], eventTypeId: bodaId, usaCapilla: true, capillaMonto: 4_000 },
      admin,
    );
    quotes.push(q.id);
    expect(q.rentaTotal).toBe(4_000);
    expect(q.etiqueta).toMatch(/CAPILLA/i);

    const primero = await registerPayment(prisma, storage, q.id,
      { monto: 1_000, metodo: 'transferencia', concepto: 'anticipo', fecha: '2065-01-10' }, admin);
    expect(primero.nuevoEstatus).toBe('formalizada');
    expect(primero.estadoCuenta).toMatchObject({ plan: null, planPendiente: true, saldo: 3_000 });

    const resto = await registerPayment(prisma, storage, q.id,
      { monto: 3_000, metodo: 'transferencia', concepto: 'finiquito', fecha: '2065-02-10' }, admin);
    expect(resto.nuevoEstatus).toBe('liquidada');

    const actual = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    const { estadoCuenta } = await loadEstadoCuenta(prisma, actual);
    expect(estadoCuenta).toMatchObject({ saldo: 0, sugerido: 'liquidada', desfase: false });
  });

  it('más de 170 invitados no caben en la capilla', async () => {
    await expect(
      createQuote(prisma, { ...base('2065-05-29'), invitados: 171, spaceIds: [], eventTypeId: bodaId, usaCapilla: true }, admin),
    ).rejects.toThrow(/cupo 170/);
  });
});
