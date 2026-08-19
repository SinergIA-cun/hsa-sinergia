import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, updateStatus, type Actor } from '../quotes/service.js';
import { clonarCatalogo } from '../pricelists/service.js';
import { getAvailability, getAgenda } from '../availability/service.js';
import { cotizacionesDesplazadas } from '../quotes/empalmes.js';
import { biEventos } from '../bi/service.js';
import { ServerStorage } from '../payments/storage.js';
import { crearApartado, cancelarApartado, convertirApartado, listarApartados, apartadoVivo } from './apartados.js';

const storage = new ServerStorage(join(tmpdir(), 'hsa-apartado-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let ventas: Actor;
let arcosId: string;
let camposId: string;
let eventTypeId: string;
let banqueteroId: string;
const ventasEmail = `ventas-apartado-${randomUUID()}@haciendasanandres.com.mx`;
const quotes: string[] = [];
const clients: string[] = [];
const banqueteros: string[] = [];
const priceLists: string[] = [];

/** Fechas de 2033: aisladas de las que usan las demás suites. */
const PRIMER_SABADO = '2033-01-01';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

/** Un vencimiento cómodamente en el futuro: los apartados de 2033 no vencen hoy. */
const VENCE = '2032-12-01';

async function nuevoApartado(over: Record<string, unknown> = {}) {
  const { apartado, avisos } = await crearApartado(
    prisma,
    (over.banqueteroId as string) ?? banqueteroId,
    { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: VENCE, ...over },
    actor,
  );
  return { apartado, avisos };
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const usuarioVentas = await prisma.user.create({
    data: {
      nombre: 'Vendedora de apartados',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventas = { id: usuarioVentas.id, role: 'ventas' };
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Salón Los Arcos' } }))!.id;
  camposId = (await prisma.space.findFirst({ where: { nombre: 'Jardín Los Campos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const b = await prisma.banquetero.create({ data: { nombre: `Apartador ${randomUUID().slice(0, 6)}` } });
  banqueteroId = b.id;
  banqueteros.push(b.id);
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  // Los catálogos de prueba, de adentro hacia afuera: los FK son RESTRICT y las
  // cotizaciones que los apuntaban ya se borraron arriba.
  await prisma.foodPackagePrice.deleteMany({ where: { package: { priceListId: { in: priceLists } } } });
  await prisma.foodPackage.deleteMany({ where: { priceListId: { in: priceLists } } });
  await prisma.addOn.deleteMany({ where: { priceListId: { in: priceLists } } });
  await prisma.rentalPrice.deleteMany({ where: { priceListId: { in: priceLists } } });
  await prisma.djHoraExtraPrice.deleteMany({ where: { priceListId: { in: priceLists } } });
  await prisma.priceList.deleteMany({ where: { id: { in: priceLists } } });
  await prisma.user.delete({ where: { id: ventas.id } });
  await app.close();
});

/** El cuerpo mínimo de una cotización, que es lo que el apartado NO tenía. */
const cuerpoCotizacion = { eventTypeId: '', invitados: 250, client: { nombre: 'Festejo Convertido' } };
function cuerpo(over: Record<string, unknown> = {}) {
  return { ...cuerpoCotizacion, eventTypeId, ...over };
}

describe('apartadoVivo (pura)', () => {
  const hoy = new Date(Date.UTC(2026, 7, 19));
  it('vivo mientras no esté cancelado, ni convertido, ni vencido', () => {
    expect(apartadoVivo({ canceladoAt: null, quoteId: null, vence: new Date(Date.UTC(2027, 0, 1)) }, hoy)).toBe(true);
    // Vence HOY: todavía bloquea.
    expect(apartadoVivo({ canceladoAt: null, quoteId: null, vence: hoy }, hoy)).toBe(true);
    expect(apartadoVivo({ canceladoAt: null, quoteId: null, vence: new Date(Date.UTC(2026, 7, 18)) }, hoy)).toBe(false);
    expect(apartadoVivo({ canceladoAt: new Date(), quoteId: null, vence: new Date(Date.UTC(2027, 0, 1)) }, hoy)).toBe(false);
    expect(apartadoVivo({ canceladoAt: null, quoteId: 'q1', vence: new Date(Date.UTC(2027, 0, 1)) }, hoy)).toBe(false);
  });
});

describe('un apartado bloquea la fecha', () => {
  it('bloquea su fecha y sus espacios, y deja libres los demás', async () => {
    const fecha = siguienteSabado();
    const antes = await getAvailability(prisma, fecha, [arcosId, camposId]);
    expect(antes.spaces.map((s) => s.level)).toEqual(['libre', 'libre']);

    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE, deposito: 30_000, depositoMetodo: 'transferencia', depositoFecha: '2026-03-05' },
      actor,
    );

    const dispo = await getAvailability(prisma, fecha, [arcosId, camposId]);
    expect(dispo.spaces[0]!.level).toBe('bloqueada');
    expect(dispo.spaces[0]!.counts.apartados).toBe(1);
    expect(dispo.spaces[0]!.apartados[0]!.apartadoId).toBe(apartado.id);
    expect(dispo.spaces[0]!.apartados[0]!.deposito).toBe(30_000);
    // El otro salón de ese día sigue vendible.
    expect(dispo.spaces[1]!.level).toBe('libre');
    expect(dispo.blocked).toBe(true);

    // Y el servidor rechaza cotizar encima, por el mismo camino que ya existía.
    await expect(
      createQuote(prisma, { fecha, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Intruso' } }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('un apartado VENCIDO deja de bloquear', async () => {
    const fecha = siguienteSabado();
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE },
      actor,
    );
    expect((await getAvailability(prisma, fecha, [arcosId])).spaces[0]!.level).toBe('bloqueada');

    // Se vence a mano (crear uno ya vencido se rechaza a propósito).
    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2020-01-01T00:00:00.000Z') },
    });
    const despues = await getAvailability(prisma, fecha, [arcosId]);
    expect(despues.spaces[0]!.level).toBe('libre');
    expect(despues.spaces[0]!.counts.apartados).toBe(0);
  });

  it('uno CANCELADO deja de bloquear', async () => {
    const fecha = siguienteSabado();
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE },
      actor,
    );
    await cancelarApartado(prisma, apartado.id, { motivo: 'ya no lo quiso' }, actor);
    const dispo = await getAvailability(prisma, fecha, [arcosId]);
    expect(dispo.spaces[0]!.level).toBe('libre');
    expect(dispo.blocked).toBe(false);
  });

  it('aparece en la agenda, en su propia lista y distinguible de una cotización', async () => {
    const fecha = siguienteSabado();
    const q = await createQuote(
      prisma,
      { fecha, invitados: 200, spaceIds: [camposId], eventTypeId, client: { nombre: 'Agenda Con Apartado' } },
      actor,
    );
    quotes.push(q.id);
    clients.push(q.clientId);
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE, nota: 'graduación 2033' },
      actor,
    );

    const agenda = await getAgenda(prisma, fecha, fecha);
    // La cotización sigue en `events`, con la MISMA forma de siempre.
    expect(agenda.events.some((e) => e.quoteId === q.id)).toBe(true);
    // El apartado va aparte: no tiene quoteId ni estatus que pintar.
    const mio = agenda.apartados.find((a) => a.apartadoId === apartado.id);
    expect(mio).toBeDefined();
    expect(mio!.banquetero).toContain('Apartador');
    expect(mio!.nota).toBe('graduación 2033');
    expect(agenda.events.some((e) => (e as { apartadoId?: string }).apartadoId != null)).toBe(false);
  });

  /**
   * Los avisos de empalme (`cotizacionesDesplazadas`) siguen mirando SOLO `Quote`.
   * Es una divergencia a propósito y hay que fijarla: `BLOQUEANTES` de
   * `empalmes.ts` dice "debe seguir a `BLOQUEO` de availability", y desde este
   * plan availability bloquea por dos motivos —cotización comprometida y
   * apartado— mientras el aviso solo conoce el primero. Sumarle los apartados
   * cambiaría la forma de `Desplazada` (`bloqueadaPor` es una cotización, con id
   * y cliente) y eso es interfaz, no API: queda para la Task 5.
   *
   * Mientras tanto el borrador desplazado por un apartado NO avisa, pero tampoco
   * se puede guardar encima: `assertEspaciosDisponibles` lo rechaza con 409.
   */
  it('un apartado bloquea pero todavía NO produce aviso de empalme (divergencia documentada)', async () => {
    const fecha = siguienteSabado();
    const borrador = await createQuote(
      prisma,
      { fecha, invitados: 200, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Borrador Desplazable' } },
      actor,
    );
    quotes.push(borrador.id);
    clients.push(borrador.clientId);

    await crearApartado(prisma, banqueteroId, { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE }, actor);

    const avisos = await cotizacionesDesplazadas(prisma, actor);
    expect(avisos.some((d) => d.id === borrador.id)).toBe(false);
  });

  it('NO suma a ningún reporte de ingreso comprometido: no tiene total', async () => {
    const fecha = siguienteSabado();
    const rango = {
      desde: new Date(`${fecha}T00:00:00.000Z`),
      hasta: new Date(`${fecha}T23:59:59.000Z`),
      limit: 50,
    };
    const antes = await biEventos(prisma, rango);
    await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE, deposito: 50_000, depositoMetodo: 'efectivo', depositoFecha: '2026-03-05' },
      actor,
    );
    const despues = await biEventos(prisma, rango);
    expect(despues).toHaveLength(antes.length);
    expect(despues.reduce((s, e) => s + e.total, 0)).toBe(antes.reduce((s, e) => s + e.total, 0));
  });
});

describe('apartar sobre una fecha comprometida: avisa, no bloquea', () => {
  it('sin confirmar responde 409 con el nombre del salón; con confirmar procede y avisa', async () => {
    const fecha = siguienteSabado();
    const q = await createQuote(
      prisma,
      { fecha, invitados: 250, spaceIds: [arcosId], eventTypeId, client: { nombre: 'Ya Comprometido' } },
      actor,
    );
    quotes.push(q.id);
    clients.push(q.clientId);
    await updateStatus(prisma, q.id, 'formalizada', actor);

    await expect(
      crearApartado(prisma, banqueteroId, { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE }, actor),
    ).rejects.toMatchObject({ status: 409 });

    const { apartado, avisos } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE, confirmar: true },
      actor,
    );
    expect(apartado.id).toBeTruthy();
    expect(avisos.map((a) => a.nombre)).toEqual(['Salón Los Arcos']);
  });

  it('sobre una fecha libre no avisa nada', async () => {
    const { avisos } = await nuevoApartado();
    expect(avisos).toHaveLength(0);
  });
});

describe('convertir el apartado', () => {
  it('crea la cotización con SU catálogo si lo tiene', async () => {
    // Un catálogo REAL: se clona el activo con el incremento negociado ("te
    // congelo 2027 más ocho por ciento"), que es el tramo 1 del Plan E cobrando.
    // Uno vacío no sirve: el motor truena por falta de rangos de renta, y eso
    // sería probar el apartado contra un catálogo que nadie podría usar.
    const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const suCatalogo = await clonarCatalogo(prisma, {
      nombre: `Garantizado-${randomUUID().slice(0, 8)}`,
      anio: 2033,
      clonarDe: activo.id,
      incrementoPct: 8,
    });
    priceLists.push(suCatalogo.id);
    const { apartado } = await nuevoApartado({ priceListId: suCatalogo.id, spaceIds: [camposId] });

    const { quote } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);
    expect(quote.priceListId).toBe(suCatalogo.id);
  });

  it('sin catálogo propio toma el activo', async () => {
    const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
    const { apartado } = await nuevoApartado();
    const { quote } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);
    expect(quote.priceListId).toBe(activo.id);
  });

  it('hereda fecha, espacios y banquetero del apartado, no del cuerpo', async () => {
    const { apartado } = await nuevoApartado({ spaceIds: [arcosId, camposId] });
    const { quote } = await convertirApartado(
      prisma,
      storage,
      apartado.id,
      // Se intenta colar otra fecha, otro espacio y otro banquetero: se ignoran.
      cuerpo({ fecha: '2033-12-31', spaceIds: [camposId], banqueteroId: null }),
      actor,
    );
    quotes.push(quote.id);
    clients.push(quote.clientId);
    expect(quote.fechaEvento.toISOString().slice(0, 10)).toBe(apartado.fechaEvento.toISOString().slice(0, 10));
    expect(quote.spaceIds.sort()).toEqual([arcosId, camposId].sort());
    expect(quote.banqueteroId).toBe(banqueteroId);
  });

  it('el depósito pasa como pago de la cotización nueva, con la fecha en que se RECIBIÓ', async () => {
    const { apartado } = await nuevoApartado({
      deposito: 40_000,
      depositoMetodo: 'transferencia',
      depositoFecha: '2026-03-05',
    });
    const { quote, pago } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    expect(pago).not.toBeNull();
    expect(pago!.monto).toBe(40_000);
    expect(pago!.folio).toBeGreaterThan(0);
    // La fecha del depósito, no la de la conversión (hoy): el mismo riesgo fiscal
    // que las asignaciones de la Task 1.
    expect(pago!.fecha.toISOString()).toBe('2026-03-05T00:00:00.000Z');

    const pagos = await prisma.payment.findMany({ where: { quoteId: quote.id } });
    expect(pagos).toHaveLength(1);
    expect(pagos[0]!.monto).toBe(40_000);
  });

  it('sin depósito no crea pago', async () => {
    const { apartado } = await nuevoApartado();
    const { quote, pago } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);
    expect(pago).toBeNull();
    expect(await prisma.payment.count({ where: { quoteId: quote.id } })).toBe(0);
  });

  it('convertir DOS veces el mismo apartado responde 409', async () => {
    const { apartado } = await nuevoApartado();
    const { quote } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);
    await expect(convertirApartado(prisma, storage, apartado.id, cuerpo(), actor)).rejects.toMatchObject({
      status: 409,
    });
    expect(await prisma.quote.count({ where: { apartado: { id: apartado.id } } })).toBe(1);
  });

  it('convertido, el apartado deja de bloquear por su cuenta: la cotización es la que bloquea', async () => {
    const fecha = siguienteSabado();
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE },
      actor,
    );
    const { quote } = await convertirApartado(prisma, storage, apartado.id, cuerpo(), actor);
    quotes.push(quote.id);
    clients.push(quote.clientId);

    const dispo = await getAvailability(prisma, fecha, [arcosId]);
    expect(dispo.spaces[0]!.counts.apartados).toBe(0);
    // La cotización nueva es un borrador: avisa pero no bloquea, como cualquiera.
    expect(dispo.spaces[0]!.level).toBe('cotizaciones');
    expect(dispo.spaces[0]!.quotes[0]!.id).toBe(quote.id);
  });

  it('un apartado cancelado no se convierte (409)', async () => {
    const { apartado } = await nuevoApartado();
    await cancelarApartado(prisma, apartado.id, { motivo: 'no procedió' }, actor);
    await expect(convertirApartado(prisma, storage, apartado.id, cuerpo(), actor)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('validaciones y permisos', () => {
  it('un depósito sin forma de pago o sin fecha de recepción se rechaza', async () => {
    await expect(nuevoApartado({ deposito: 10_000 })).rejects.toThrow();
    await expect(nuevoApartado({ deposito: 10_000, depositoMetodo: 'efectivo' })).rejects.toThrow();
  });

  it('un depósito con decimales se rechaza, no se redondea', async () => {
    await expect(
      nuevoApartado({ deposito: 10_000.5, depositoMetodo: 'efectivo', depositoFecha: '2026-03-05' }),
    ).rejects.toThrow();
  });

  it('un vencimiento ya pasado se rechaza (nacería sin bloquear nada)', async () => {
    await expect(nuevoApartado({ vence: '2020-01-01' })).rejects.toMatchObject({ status: 400 });
  });

  /**
   * Un `spaceId` inventado no lo atrapa nadie: el apartado no pasa por el motor
   * de precios, que es quien truena al cotizar. Sin esta validación quedaría
   * guardado bloqueando NADA —depósito cobrado, fecha libre para que alguien más
   * la venda— y eso no falla en ninguna parte hasta que hay dos eventos el mismo
   * día en el mismo salón.
   */
  it('un espacio que no existe se rechaza (o el apartado no bloquearía nada)', async () => {
    await expect(nuevoApartado({ spaceIds: ['no-existe'] })).rejects.toMatchObject({ status: 400 });
    await expect(nuevoApartado({ spaceIds: [arcosId, 'no-existe'] })).rejects.toMatchObject({ status: 400 });
  });

  it('un banquetero o un catálogo que no existen se rechazan', async () => {
    await expect(nuevoApartado({ banqueteroId: 'no-existe' })).rejects.toMatchObject({ status: 404 });
    await expect(nuevoApartado({ priceListId: 'no-existe' })).rejects.toMatchObject({ status: 400 });
  });

  it('ventas puede apartar; solo admin cancela', async () => {
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], vence: VENCE },
      ventas,
    );
    expect(apartado.createdById).toBe(ventas.id);
    await expect(cancelarApartado(prisma, apartado.id, { motivo: 'no va' }, ventas)).rejects.toMatchObject({
      status: 403,
    });
    const cancelado = await cancelarApartado(prisma, apartado.id, { motivo: 'no va' }, actor);
    expect(cancelado.canceladoById).toBe(actor.id);
  });

  it('listarApartados marca vivo/vencido y trae el catálogo garantizado', async () => {
    const soloDeEste = await prisma.banquetero.create({ data: { nombre: `Solo ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(soloDeEste.id);
    const { apartado } = await nuevoApartado({ banqueteroId: soloDeEste.id });
    const lista = await listarApartados(prisma, soloDeEste.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.vivo).toBe(true);
    expect(lista[0]!.vencido).toBe(false);

    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2020-01-01T00:00:00.000Z') },
    });
    const despues = await listarApartados(prisma, soloDeEste.id);
    expect(despues[0]!.vivo).toBe(false);
    expect(despues[0]!.vencido).toBe(true);
  });

  it('POST /banqueteros/:id/apartados responde 201 y 409 sobre fecha comprometida', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const c = login.cookies[0]!;
    const cookies = { [c.name]: c.value };
    const fecha = siguienteSabado();

    const ok = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/${banqueteroId}/apartados`,
      payload: { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE },
      cookies,
    });
    expect(ok.statusCode).toBe(201);

    const choque = await app.inject({
      method: 'POST',
      url: `/api/banqueteros/${banqueteroId}/apartados`,
      payload: { fechaEvento: fecha, spaceIds: [arcosId], vence: VENCE },
      cookies,
    });
    expect(choque.statusCode).toBe(409);
    expect(choque.json().error).toContain('Salón Los Arcos');
  });
});
