import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { convertirApartado, renovarApartado } from '../banqueteros/apartados.js';
import { getAgenda } from '../availability/service.js';
import { conciliarApartados, importarApartados, type ApartadoBI } from './apartados.js';
import { biApartados } from './service.js';

/**
 * El BI manda sus fechas apartadas (C5). Lo que se protege: idempotencia por
 * idBI, que no se pise lo que existe, que un apartado de cliente directo funcione
 * igual que uno de banquetero, y que lo importado no venza antes de su fecha.
 */

const storage = new ServerStorage(join(tmpdir(), 'hsa-bi-apartados-test-' + randomUUID()));
const SUF = randomUUID().slice(0, 6);
let admin: Actor;
let arcosId: string;
let xvId: string;
let banqueteroId: string;
const BANQUETERO = `Victor Gonzalez ${SUF}`;
const idsBI: string[] = [];
const quotes: string[] = [];
const clients: string[] = [];

// Martes de 2093: lejos de cualquier otra suite.
let semana = 0;
const martes = () => new Date(Date.UTC(2093, 0, 6 + 7 * semana++)).toISOString().slice(0, 10);
// Folios por debajo de la serie del dev y lejos de los demás: no la mueven.
let folioSeq = 10_000 + Math.floor(Math.random() * 25_000);
const folio = () => folioSeq++;

function apartadoBI(over: Partial<ApartadoBI> = {}): ApartadoBI {
  const idBI = `AP-${randomUUID().slice(0, 8)}`;
  idsBI.push(over.idBI ?? idBI);
  return {
    idBI,
    fecha: martes(),
    salones: ['Arcos'],
    tipoEvento: 'XV',
    banquetero: BANQUETERO,
    cliente: null,
    precioAcordado: null,
    pagos: [{ folio: folio(), fecha: '2026-05-20', monto: 25_000, metodo: 'transferencia' }],
    ...over,
  };
}

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  xvId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'xv' } })).id;
  banqueteroId = (await prisma.banquetero.create({ data: { nombre: BANQUETERO, telefono: '5598760000' } })).id;
});

afterAll(async () => {
  const aps = await prisma.apartadoFecha.findMany({ where: { importadoBI: { in: idsBI } }, select: { id: true, clientId: true, quoteId: true } });
  const qIds = [...quotes, ...aps.map((a) => a.quoteId).filter((x): x is string => !!x)];
  await prisma.abonoApartado.deleteMany({ where: { apartadoId: { in: aps.map((a) => a.id) } } });
  await prisma.apartadoFecha.deleteMany({ where: { id: { in: aps.map((a) => a.id) } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: qIds } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: qIds } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: qIds } } });
  const qs = await prisma.quote.findMany({ where: { id: { in: qIds } }, select: { clientId: true } });
  await prisma.quote.deleteMany({ where: { id: { in: qIds } } });
  const cIds = [...clients, ...qs.map((q) => q.clientId), ...aps.map((a) => a.clientId).filter((x): x is string => !!x)];
  await prisma.client.deleteMany({ where: { id: { in: cIds } } });
  await prisma.banquetero.delete({ where: { id: banqueteroId } });
});

describe('importar apartados del BI', () => {
  it('conciliar no escribe; importar crea con su abono, folio de papel y sin vencer antes de su fecha', async () => {
    const ap = apartadoBI();
    const c = await conciliarApartados(prisma, { apartados: [ap] });
    expect(c.resultados[0]).toMatchObject({ estado: 'nuevo' });
    expect(await prisma.apartadoFecha.count({ where: { importadoBI: ap.idBI } })).toBe(0);

    const i = await importarApartados(prisma, { apartados: [ap] });
    expect(i.resultados[0]).toMatchObject({ estado: 'nuevo', accion: 'creado' });
    const creado = await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI }, include: { abonos: true } });
    expect(creado.banqueteroId).toBe(banqueteroId);
    expect(creado.eventTypeId).toBe(xvId);
    expect(creado.vence.toISOString().slice(0, 10)).toBe(ap.fecha);
    expect(creado.abonos.map((x) => [x.folio, x.monto])).toEqual([[ap.pagos[0]!.folio, 25_000]]);

    // Idempotente: la segunda vez cuadra y no crea nada.
    const otra = await importarApartados(prisma, { apartados: [ap] });
    expect(otra.resultados[0]).toMatchObject({ estado: 'igual', apartadoId: creado.id });
    expect(await prisma.apartadoFecha.count({ where: { importadoBI: ap.idBI } })).toBe(1);
  });

  it('el de un cliente directo guarda el cliente y el precio acordado; se convierte con su teléfono', async () => {
    const ap = apartadoBI({ banquetero: null, cliente: { nombre: `Carolina Quiroz ${SUF}` }, precioAcordado: 169_000 });
    await importarApartados(prisma, { apartados: [ap] });
    const creado = await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI }, include: { client: true } });
    expect(creado.banqueteroId).toBeNull();
    expect(creado.client?.nombre).toBe(`Carolina Quiroz ${SUF}`);
    expect(creado.precioAcordado).toBe(169_000);

    // La agenda lo enseña con el nombre de quien apartó.
    const agenda = await getAgenda(prisma, ap.fecha, ap.fecha);
    expect(agenda.apartados.find((x) => x.apartadoId === creado.id)).toMatchObject({ banquetero: `Carolina Quiroz ${SUF}`, banqueteroId: null, clienteId: creado.clientId });

    // Sin teléfono ni correo el contrato no se puede hacer: el cliente vino del BI sin ninguno.
    await expect(convertirApartado(prisma, storage, creado.id, { invitados: 200 }, admin)).rejects.toMatchObject({ status: 400 });
    const { quote } = await convertirApartado(prisma, storage, creado.id, { invitados: 200, client: { telefono: '5544332211', nombre: 'Otro nombre' } }, admin);
    expect(quote.clientId).toBe(creado.clientId);
    expect(quote.banqueteroId).toBeNull();
    expect(quote.eventTypeId).toBe(xvId);
    // El nombre lo impone el apartado; el teléfono se completó.
    expect(await prisma.client.findUniqueOrThrow({ where: { id: creado.clientId! } })).toMatchObject({ nombre: `Carolina Quiroz ${SUF}`, telefono: '5544332211' });
    const pagos = await prisma.payment.findMany({ where: { quoteId: quote.id } });
    expect(pagos.map((p) => p.folio)).toEqual([ap.pagos[0]!.folio]);
    // La renta acordada MANDA: reemplaza la del catálogo y deja el precio pactado.
    expect(quote.rentaTotal).toBe(169_000);
    expect(quote.precioPactado).toBe(true);
    const lineas = (quote.breakdown as { lines: { grupo: string; spaceId?: string; monto: number; detalle?: string }[] }).lines;
    expect(lineas.filter((l) => l.grupo === 'renta' && l.spaceId)).toEqual([expect.objectContaining({ monto: 169_000, detalle: 'Renta acordada al apartar' })]);
    const log = await prisma.activityLog.findFirst({ where: { quoteId: quote.id, descripcion: { contains: 'Renta acordada' } } });
    expect(log?.descripcion).toContain('169,000');
  });

  it('renovar no le acorta el plazo a uno importado', async () => {
    const ap = apartadoBI();
    await importarApartados(prisma, { apartados: [ap] });
    const creado = await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI } });
    const renovado = await renovarApartado(prisma, creado.id, { confirmar: true }, admin);
    expect(renovado.vence.toISOString().slice(0, 10)).toBe(ap.fecha);
  });

  it('reporta lo que cambió en el BI sin pisar nada', async () => {
    const ap = apartadoBI();
    await importarApartados(prisma, { apartados: [ap] });
    const cambiado = { ...ap, precioAcordado: 150_000, pagos: [...ap.pagos, { folio: folio(), fecha: '2026-06-01', monto: 5_000, metodo: 'efectivo' as const }] };
    const r = await importarApartados(prisma, { apartados: [cambiado] });
    expect(r.resultados[0]!.estado).toBe('difiere');
    expect(r.resultados[0]!.diferencias!.map((d) => d.campo).sort()).toEqual(['folios', 'pagado', 'precioAcordado']);
    expect((await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI } })).precioAcordado).toBeNull();
  });

  it('una fecha y salón ya ocupados salen posibleDuplicado y no se importan', async () => {
    const fecha = martes();
    const q = await createQuote(prisma, { fecha, invitados: 200, spaceIds: [arcosId], eventTypeId: xvId, client: { nombre: 'Ya estaba', telefono: '5511223344' } }, admin);
    quotes.push(q.id);
    clients.push(q.clientId);
    const ap = apartadoBI({ fecha });
    const r = await importarApartados(prisma, { apartados: [ap] });
    expect(r.resultados[0]).toMatchObject({ estado: 'posibleDuplicado' });
    expect(r.resultados[0]!.candidatos![0]).toMatchObject({ tipo: 'evento', id: q.id });
    expect(await prisma.apartadoFecha.count({ where: { importadoBI: ap.idBI } })).toBe(0);
  });

  it('no importa: banquetero sin dar de alta, salón desconocido o un folio que ya tiene otro dinero', async () => {
    const primero = apartadoBI();
    await importarApartados(prisma, { apartados: [primero] });
    const r = await importarApartados(prisma, {
      apartados: [
        apartadoBI({ banquetero: 'Nadie Conocido' }),
        apartadoBI({ salones: ['Terraza'] }),
        apartadoBI({ pagos: [{ folio: primero.pagos[0]!.folio, fecha: '2026-05-20', monto: 1_000, metodo: 'efectivo' }] }),
      ],
    });
    expect(r.resultados.map((x) => x.estado)).toEqual(['invalido', 'invalido', 'invalido']);
    expect(r.resultados[0]!.errores![0]).toContain('/importar/banqueteros');
    expect(r.resultados[2]!.errores![0]).toContain('ya tiene otro dinero');
  });

  it('banquetero y cliente a la vez (o ninguno) rechaza el lote entero', async () => {
    await expect(importarApartados(prisma, { apartados: [apartadoBI({ cliente: { nombre: 'Doble' } })] })).rejects.toThrow();
    await expect(importarApartados(prisma, { apartados: [apartadoBI({ banquetero: null })] })).rejects.toThrow();
  });

  it('/apartados (lectura) los lista por fecha y dice a qué evento pasó el convertido (C6)', async () => {
    const ap = apartadoBI({ banquetero: null, cliente: { nombre: `Leído ${SUF}`, telefono: '5577889900' }, precioAcordado: 120_000 });
    await importarApartados(prisma, { apartados: [ap] });
    const creado = await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI } });
    const dia = new Date(`${ap.fecha}T00:00:00.000Z`);
    const rango = { desde: dia, hasta: new Date(`${ap.fecha}T23:59:59.999Z`), limit: 500 };
    const [antes] = (await biApartados(prisma, rango)).filter((x) => x.id === creado.id);
    expect(antes).toMatchObject({ importadoBI: ap.idBI, estado: 'vivo', precioAcordado: 120_000, abonado: 25_000, quoteId: null, banquetero: null });
    expect(antes!.cliente?.nombre).toBe(`Leído ${SUF}`);
    expect(antes!.abonos[0]).toMatchObject({ folio: ap.pagos[0]!.folio, monto: 25_000, anulado: false });

    const { quote } = await convertirApartado(prisma, storage, creado.id, { invitados: 150 }, admin);
    const [despues] = (await biApartados(prisma, rango)).filter((x) => x.id === creado.id);
    expect(despues).toMatchObject({ estado: 'convertido', quoteId: quote.id, eventoFolio: quote.folio });
  });

  it('el idBI de cada pago se guarda, pasa al pago del evento al convertir y sale en /pagos y /eventos (P2, §4)', async () => {
    const idPago = `R-${randomUUID().slice(0, 6)}`;
    const ap = apartadoBI({
      usaCapilla: true,
      pagos: [{ idBI: idPago, folio: folio(), fecha: '2026-05-20', monto: 25_000, metodo: 'transferencia' }],
    });
    await importarApartados(prisma, { apartados: [ap] });
    const creado = await prisma.apartadoFecha.findUniqueOrThrow({ where: { importadoBI: ap.idBI }, include: { abonos: true } });
    expect(creado.usaCapilla).toBe(true);
    expect(creado.abonos[0]!.importadoBI).toBe(idPago);
    const rango = { desde: new Date(`${ap.fecha}T00:00:00.000Z`), hasta: new Date(`${ap.fecha}T23:59:59.999Z`), limit: 500 };
    expect((await biApartados(prisma, rango)).find((x) => x.id === creado.id)?.abonos[0]?.idBI).toBe(idPago);

    const { quote } = await convertirApartado(prisma, storage, creado.id, { invitados: 150 }, admin);
    expect(quote.usaCapilla).toBe(true);
    const pago = await prisma.payment.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(pago.importadoBI).toBe(idPago);
    const { biPagos, biEventos } = await import('./service.js');
    const delDia = { desde: new Date('2026-05-20T00:00:00.000Z'), hasta: new Date('2026-05-20T23:59:59.999Z'), limit: 500 };
    expect((await biPagos(prisma, delDia)).find((p) => p.id === pago.id)?.idBI).toBe(idPago);
    // El evento hereda el idBI del apartado, y sin renta acordada NO queda con precio pactado.
    const ev = (await biEventos(prisma, rango)).find((e) => e.id === quote.id);
    expect(ev).toMatchObject({ idBI: ap.idBI, origen: 'bi' });
    expect(quote.precioPactado).toBe(false);
  });
});
