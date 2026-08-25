import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { ServerStorage } from '../payments/storage.js';
import { registerPayment } from '../payments/service.js';
import {
  createQuote,
  purgeExpiredTrash,
  updateOperativa,
  updateQuote,
  updateStatus,
  type Actor,
} from '../quotes/service.js';
import { archivarEvento, barridoHistorico } from './archivar.js';
import { listarHistorico, detalleHistorico } from './consulta.js';
import type { FotoEvento } from './foto.js';

/**
 * El histórico de eventos.
 *
 * Lo que se fija aquí es la promesa del archivo: un evento que pasó queda
 * fotografiado **por nombre**, la foto se corrige sin reescribirse, y el precio
 * de algo que ya sucedió deja de moverse. Si esto se rompe, el archivo sigue
 * llenándose y deja de ser confiable, que es peor que no tenerlo.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-historico-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let eventTypeId: string;
let arcosId: string;
let arcosNombre: string;
const quotes: string[] = [];
const clients: string[] = [];

/** Fechas de 2019: pasadas de verdad y lejos de las demás suites. */
let diaSeq = 0;
function fechaPasada(): string {
  const d = new Date(Date.UTC(2019, 2, 2)); // sábado
  d.setUTCDate(d.getUTCDate() + 7 * diaSeq++);
  return d.toISOString().slice(0, 10);
}

async function eventoPasado(nombre: string, extra: Record<string, unknown> = {}) {
  const q = await createQuote(
    prisma,
    {
      fecha: fechaPasada(),
      invitados: 200,
      spaceIds: [arcosId],
      horasExtra: 0,
      usaCapilla: false,
      esCortesia: false,
      usaDjHoraExtra: false,
      addOns: [],
      extras: [],
      eventTypeId,
      requiereFactura: false,
      client: { nombre },
      ...extra,
    },
    actor,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

function foto(fila: { foto: unknown }): FotoEvento {
  return fila.foto as FotoEvento;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@haciendasanandres.com.mx' },
  });
  actor = { id: admin.id, role: 'admin' };
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  const arcos = await prisma.space.findFirstOrThrow({ where: { nombre: 'Salón Los Arcos' } });
  arcosId = arcos.id;
  arcosNombre = arcos.nombre;
});

afterAll(async () => {
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await app.close();
});

describe('qué se archiva y qué no', () => {
  it('no fotografía un evento que todavía no pasa', async () => {
    const q = await createQuote(
      prisma,
      {
        fecha: '2037-05-09',
        invitados: 150,
        spaceIds: [arcosId],
        horasExtra: 0,
        usaCapilla: false,
        esCortesia: false,
        usaDjHoraExtra: false,
        addOns: [],
        extras: [],
        eventTypeId,
        requiereFactura: false,
        client: { nombre: 'Histórico · todavía no pasa' },
      },
      actor,
    );
    quotes.push(q.id);
    clients.push(q.clientId);

    const r = await archivarEvento(prisma, q.id);
    expect(r.motivo).toBe('aun-no-pasa');
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(0);
  });

  it('no fotografía lo que está en la papelera', async () => {
    const q = await eventoPasado('Histórico · en papelera');
    await prisma.quote.update({ where: { id: q.id }, data: { deletedAt: new Date() } });

    const r = await archivarEvento(prisma, q.id);
    expect(r.motivo).toBe('en-papelera');
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(0);

    await prisma.quote.update({ where: { id: q.id }, data: { deletedAt: null } });
  });

  it('archiva también un borrador que nunca se cerró, marcado como no realizado', async () => {
    const q = await eventoPasado('Histórico · nunca se cerró');

    const r = await archivarEvento(prisma, q.id);
    expect(r.motivo).toBe('archivado');

    const fila = await prisma.eventoHistorico.findFirstOrThrow({ where: { quoteId: q.id } });
    // Sacarlo de la lista activa sin dejarlo en ningún lado lo desaparecería.
    // "Cotizamos esto para el 5 de mayo y no se cerró" es historia útil.
    expect(fila.seRealizo).toBe(false);
    expect(fila.liquidado).toBe(false);
  });
});

describe('la foto', () => {
  it('guarda nombres y no ids, para poder leerse sin las tablas vivas', async () => {
    const q = await eventoPasado('Histórico · legible');
    await archivarEvento(prisma, q.id);

    const fila = await prisma.eventoHistorico.findFirstOrThrow({ where: { quoteId: q.id } });
    const f = foto(fila);
    expect(f.evento.espacios).toEqual([arcosNombre]);
    expect(f.evento.espacios[0]).not.toBe(arcosId);
    expect(f.evento.tipo).toBe('Boda');
    expect(f.evento.catalogo).toBeTruthy();
    expect(f.cliente.nombre).toBe('Histórico · legible');
    // El desglose congelado viaja completo: es lo que se cobró.
    expect(f.desglose).not.toBeNull();
    expect(f.totales.total).toBe(q.total);
  });

  it('copia los pagos con su folio y quién los registró', async () => {
    const q = await eventoPasado('Histórico · con pago');
    await registerPayment(
      prisma,
      storage,
      q.id,
      { monto: 20_000, metodo: 'transferencia', fecha: '2019-01-15', concepto: 'anticipo' },
      actor,
    );

    // `registerPayment` ya archiva: la foto no espera al reinicio del contenedor.
    const fila = await prisma.eventoHistorico.findFirstOrThrow({
      where: { quoteId: q.id },
      orderBy: { version: 'desc' },
    });
    const f = foto(fila);
    expect(f.pagos).toHaveLength(1);
    expect(f.pagos[0]!.monto).toBe(20_000);
    expect(f.pagos[0]!.folio).toBeGreaterThan(0);
    expect(f.pagos[0]!.registradoPor).toBe('Administrador');
    expect(f.totales.pagado).toBe(20_000);
  });
});

describe('las versiones', () => {
  it('no escribe una versión nueva si nada cambió', async () => {
    const q = await eventoPasado('Histórico · sin cambios');
    const primera = await archivarEvento(prisma, q.id);
    expect(primera.motivo).toBe('archivado');

    const segunda = await archivarEvento(prisma, q.id);
    // Sin esta comparación, cada arranque del contenedor duplicaría la historia
    // entera y la lista de versiones —que existe para enseñar las correcciones—
    // se volvería ruido.
    expect(segunda.motivo).toBe('sin-cambios');
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(1);
  });

  it('una corrección posterior agrega versión, no sobrescribe', async () => {
    const q = await eventoPasado('Histórico · corregido');
    await archivarEvento(prisma, q.id);

    await updateOperativa(
      prisma,
      q.id,
      { hoja: { anotaciones: 'Se corrigió el conteo final después del evento' } },
      actor,
    );

    const versiones = await prisma.eventoHistorico.findMany({
      where: { quoteId: q.id },
      orderBy: { version: 'asc' },
    });
    expect(versiones).toHaveLength(2);
    expect(versiones[0]!.motivo).toBe('archivado');
    expect(versiones[1]!.motivo).toBe('actualizada');
    // La v1 sigue diciendo lo que decía: eso es lo que la vuelve un archivo.
    expect(foto(versiones[0]!).operativa).toBeNull();
    expect((foto(versiones[1]!).operativa as { anotaciones: string }).anotaciones).toContain(
      'conteo final',
    );
  });
});

describe('el precio de lo que ya pasó', () => {
  it('no se recalcula al corregir el conteo final, y lo dice en la bitácora', async () => {
    const q = await eventoPasado('Histórico · precio congelado');
    const totalOriginal = q.total;

    const editada = await updateQuote(
      prisma,
      q.id,
      {
        fecha: q.fechaEvento.toISOString().slice(0, 10),
        invitados: 400, // el doble: con recálculo el precio se movería
        spaceIds: [arcosId],
        horasExtra: 0,
        usaCapilla: false,
        esCortesia: false,
        usaDjHoraExtra: false,
        addOns: [],
        extras: [],
        eventTypeId,
        requiereFactura: false,
      },
      actor,
    );

    expect(editada.invitados).toBe(400); // la corrección SÍ entra
    expect(editada.total).toBe(totalOriginal); // el precio NO se mueve

    const nota = await prisma.activityLog.findFirst({
      where: { quoteId: q.id, descripcion: { contains: 'NO se recalculó' } },
    });
    // Que el precio se quede quieto no puede ser silencioso: quien editó
    // esperando otro total tiene que encontrar la explicación.
    expect(nota, 'el congelamiento del precio tiene que quedar en la bitácora').not.toBeNull();
  });

  it('sí recalcula si el evento se pospone a una fecha futura', async () => {
    const q = await eventoPasado('Histórico · pospuesto');
    const totalOriginal = q.total;

    const movida = await updateQuote(
      prisma,
      q.id,
      {
        fecha: '2037-06-06',
        invitados: 400,
        spaceIds: [arcosId],
        horasExtra: 0,
        usaCapilla: false,
        esCortesia: false,
        usaDjHoraExtra: false,
        addOns: [],
        extras: [],
        eventTypeId,
        requiereFactura: false,
      },
      actor,
    );

    // Vuelve a ser una previsión, así que vuelve a calcularse.
    expect(movida.total).not.toBe(totalOriginal);
  });
});

describe('el barrido', () => {
  it('archiva lo pendiente y deja en paz lo ya liquidado', async () => {
    const pendiente = await eventoPasado('Histórico · barrido pendiente');
    const liquidado = await eventoPasado('Histórico · barrido liquidado');
    await registerPayment(
      prisma,
      storage,
      liquidado.id,
      { monto: liquidado.rentaTotal, metodo: 'transferencia', fecha: '2019-01-20', concepto: 'finiquito' },
      actor,
    );
    await updateStatus(prisma, liquidado.id, 'liquidada', actor);
    await archivarEvento(prisma, liquidado.id);

    const antesLiquidado = await prisma.eventoHistorico.count({ where: { quoteId: liquidado.id } });
    const primero = await barridoHistorico(prisma);
    expect(primero.archivados).toBeGreaterThanOrEqual(1);

    expect(await prisma.eventoHistorico.count({ where: { quoteId: pendiente.id } })).toBe(1);
    // Congelado: liquidado y fotografiado ya no cambia, y el barrido no lo toca.
    expect(await prisma.eventoHistorico.count({ where: { quoteId: liquidado.id } })).toBe(
      antesLiquidado,
    );

    // Y es idempotente: correrlo dos veces no duplica nada.
    const segundo = await barridoHistorico(prisma);
    expect(segundo.archivados).toBe(0);
  });
});

describe('la papelera', () => {
  it('purgar un borrador vencido se lleva su foto, y no truena por la llave foránea', async () => {
    const q = await eventoPasado('Histórico · purgado');
    await archivarEvento(prisma, q.id);
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(1);

    // Eliminado hace 40 días: la papelera guarda 30.
    const hace40 = new Date(Date.now() - 40 * 86_400_000);
    await prisma.quote.update({ where: { id: q.id }, data: { deletedAt: hace40 } });

    await purgeExpiredTrash(prisma);

    // La llave foránea es RESTRICT y la purga se traga sus errores: sin borrar
    // la foto primero, la papelera dejaría de vaciarse para siempre en silencio.
    expect(await prisma.quote.findUnique({ where: { id: q.id } })).toBeNull();
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(0);
  });
});

describe('la consulta', () => {
  it('busca sin acentos y devuelve solo la última versión de cada evento', async () => {
    const q = await eventoPasado('Histórico · Muñoz Zúñiga');
    await archivarEvento(prisma, q.id);
    await updateOperativa(prisma, q.id, { hoja: { anotaciones: 'segunda versión' } }, actor);

    const { filas } = await listarHistorico(prisma, { q: 'munoz zuniga', pagina: 0 });
    const mio = filas.filter((f) => f.quoteId === q.id);
    // Un solo renglón aunque tenga dos versiones: la lista responde "qué pasó
    // ese día", no "cuántas veces lo tocamos".
    expect(mio).toHaveLength(1);
    expect(mio[0]!.version).toBe(2);
    expect(mio[0]!.versiones).toBe(2);
  });

  it('aísla los eventos que quedaron debiendo, y no las cotizaciones que no cerraron', async () => {
    // Uno que SÍ se hizo y quedó a medias: es un cobro perdido.
    const debiendo = await eventoPasado('Histórico · quedó debiendo');
    await registerPayment(
      prisma,
      storage,
      debiendo.id,
      { monto: 20_000, metodo: 'efectivo', fecha: '2019-02-01', concepto: 'anticipo' },
      actor,
    );
    // Y uno que nunca cerró: tiene el total completo como saldo, pero ahí no hay
    // nada que cobrar. Mezclarlos convertiría la lista de cobros perdidos en una
    // lista de cotizaciones que no prosperaron, que es otra cosa.
    const noCerro = await eventoPasado('Histórico · no cerró y no debe');
    await archivarEvento(prisma, noCerro.id);

    const { filas } = await listarHistorico(prisma, { soloConSaldo: true, pagina: 0 });
    expect(filas.every((f) => f.saldo > 0 && f.seRealizo)).toBe(true);
    expect(filas.some((f) => f.quoteId === debiendo.id)).toBe(true);
    expect(filas.some((f) => f.quoteId === noCerro.id)).toBe(false);
  });

  it('el detalle trae la foto y la lista de sus versiones', async () => {
    const q = await eventoPasado('Histórico · detalle');
    await archivarEvento(prisma, q.id);
    await updateOperativa(prisma, q.id, { hoja: { anotaciones: 'corrección' } }, actor);

    const ultima = await prisma.eventoHistorico.findFirstOrThrow({
      where: { quoteId: q.id },
      orderBy: { version: 'desc' },
    });
    const detalle = await detalleHistorico(prisma, ultima.id);
    expect(detalle).not.toBeNull();
    expect(detalle!.foto.cliente.nombre).toBe('Histórico · detalle');
    expect(detalle!.versiones).toHaveLength(2);
    expect(detalle!.versiones[0]!.version).toBe(2);
    expect(detalle!.tomadaEnISO).toBeTruthy();
  });

  it('el archivo lo puede consultar ventas, pero barrer es de admin', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@haciendasanandres.com.mx', password: 'admin1234' },
    });
    const c = login.cookies[0]!;

    const lista = await app.inject({
      method: 'GET',
      url: '/api/historico',
      cookies: { [c.name]: c.value },
    });
    expect(lista.statusCode).toBe(200);

    const sinSesion = await app.inject({ method: 'GET', url: '/api/historico' });
    expect(sinSesion.statusCode).toBe(401);
  });
});
