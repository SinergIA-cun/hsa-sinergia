import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { createQuote, updateQuote, moverCatalogo, type Actor } from '../quotes/service.js';
import { registerPayment } from '../payments/service.js';
import { ServerStorage } from '../payments/storage.js';
import { importarLote, conciliarLote, type EventoBI } from './importar.js';
import { registrarCargo } from '../cargos/service.js';
import { archivarEvento } from '../historico/archivar.js';

/**
 * Importar del BI los eventos vendidos antes del sistema, de cualquier fecha, y
 * conciliarlos. Lo que se protege: idempotencia, que nunca
 * se pise lo que ya existe, y que el precio pactado no se recotice.
 */

const LLAVE_IMPORTAR = 'i'.repeat(64);
const LLAVE_LEER = 'l'.repeat(64);
const storage = new ServerStorage(join(tmpdir(), 'hsa-importar-test-' + randomUUID()));

let app: FastifyInstance;
let admin: Actor;
let arcosId: string;
const idsBI: string[] = [];
const quotesNativas: string[] = [];

const PRIMER_SABADO = '2043-01-03';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

function eventoBI(over: Partial<EventoBI> = {}): EventoBI {
  const idBI = `BI-${randomUUID().slice(0, 8)}`;
  idsBI.push(over.idBI ?? idBI);
  return {
    idBI,
    fechaContratacion: '2026-02-02',
    fechaEvento: siguienteSabado(),
    tipoEvento: 'Boda',
    salones: ['Arcos'],
    invitados: 220,
    cliente: { nombre: 'Importado Del BI', telefono: `55${Math.floor(Math.random() * 1e8)}` },
    renta: { total: 95_000 },
    otros: { total: 120_000 },
    pagos: [
      { folio: 5101, fecha: '2026-02-02', monto: 20_000, metodo: 'transferencia' },
      { folio: 5190, fecha: '2026-06-15', monto: 10_000, formas: [{ forma: 'efectivo', monto: 4_000 }, { forma: 'cheque', monto: 6_000 }] },
    ],
    ...over,
  };
}

beforeAll(async () => {
  app = await buildServer({
    config: { ...loadConfig(), BI_API_KEY: LLAVE_LEER, BI_IMPORT_API_KEY: LLAVE_IMPORTAR },
  });
  await app.ready();
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
});

afterAll(async () => {
  const quotes = await prisma.quote.findMany({
    where: { OR: [{ importadoBI: { in: idsBI } }, { id: { in: quotesNativas } }] },
    select: { id: true, clientId: true },
  });
  const ids = quotes.map((q) => q.id);
  await prisma.payment.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.cargoEvento.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.eventoHistorico.deleteMany({ where: { quoteId: { in: ids } } });
  await prisma.quote.deleteMany({ where: { id: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: quotes.map((q) => q.clientId) } } });
  await app.close();
});

describe('importar un evento nuevo', () => {
  it('lo crea con precio pactado, folio de su contratación, sus pagos con folio de papel y el estatus que dicen los pagos', async () => {
    const ev = eventoBI();
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]).toMatchObject({ idBI: ev.idBI, estado: 'nuevo', accion: 'creado' });

    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI }, include: { payments: true } });
    expect(q.folio).toMatch(/^26FEB-\d{4,}$/);
    expect(q.contratadoEl?.toISOString().slice(0, 10)).toBe('2026-02-02');
    expect(q.rentaTotal).toBe(95_000);
    expect(q.total).toBe(215_000);
    expect(q.spaceIds).toEqual([arcosId]);
    // 30,000 pagados cruzan el anticipo de Arcos (20,000) y su complemento (10% de
    // 95,000 = 9,500; acumulado 29,500): el estatus sube solo a complementada.
    expect(q.status).toBe('complementada');
    const pagos = [...q.payments].sort((a, b) => a.folio - b.folio);
    expect(pagos.map((p) => p.folio)).toEqual([5101, 5190]);
    expect(pagos[1]!.metodo).toBe('mixto');
    // El concepto se dedujo del saldo, como cualquier pago.
    expect(pagos[0]!.concepto).toBe('anticipo');
  });

  it('mandarlo otra vez no lo duplica: sale igual', async () => {
    const ev = eventoBI();
    await importarLote(prisma, { eventos: [ev] });
    const otra = await importarLote(prisma, { eventos: [ev] });
    expect(otra.resultados[0]).toMatchObject({ estado: 'igual' });
    expect(otra.resultados[0]!.accion).toBeUndefined();
    expect(await prisma.quote.count({ where: { importadoBI: ev.idBI } })).toBe(1);
  });

  it('editarlo no lo recotiza: el precio pactado se queda', async () => {
    const ev = eventoBI();
    await importarLote(prisma, { eventos: [ev] });
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    await updateQuote(
      prisma,
      q.id,
      {
        fecha: q.fechaEvento.toISOString().slice(0, 10),
        invitados: 300,
        spaceIds: q.spaceIds,
        eventTypeId: q.eventTypeId,
        horasExtra: 0,
        addOns: [],
        extras: [],
        requiereFactura: false,
      },
      admin,
    );
    const despues = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(despues.invitados).toBe(300);
    expect(despues.total).toBe(215_000);
    expect(despues.rentaTotal).toBe(95_000);
  });

  it('tampoco se puede mover de catálogo: sería recotizarlo', async () => {
    const ev = eventoBI();
    await importarLote(prisma, { eventos: [ev] });
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    const otro = await prisma.priceList.findFirstOrThrow({ where: { id: { not: q.priceListId } } }).catch(() => null);
    await expect(moverCatalogo(prisma, q.id, otro?.id ?? q.priceListId, admin)).rejects.toMatchObject({ status: 409 });
  });
});

describe('eventos ya cerrados (agosto y septiembre de 2026)', () => {
  // "Nos van a mandar los eventos cerrados de agosto y septiembre 2026 para tener
  // un poco de historial" (el dueño, 5-oct-2026). Martes: en el dev no hay nada
  // esas fechas y no chocan con un sábado de verdad.
  it('entra, queda archivado en el Histórico en ese momento y se le pueden cargar horas extra', async () => {
    const ev = eventoBI({
      fechaEvento: '2026-08-11',
      fechaContratacion: '2026-01-20',
      pagos: [
        { folio: 5102, fecha: '2026-01-20', monto: 20_000, metodo: 'transferencia' },
        { folio: 5191, fecha: '2026-08-03', monto: 75_000, metodo: 'transferencia' },
      ],
    });
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]).toMatchObject({ estado: 'nuevo', accion: 'creado' });

    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    // Pagó la renta completa: queda liquidado, como uno capturado aquí.
    expect(q.status).toBe('liquidada');
    const fotos = await prisma.eventoHistorico.findMany({ where: { quoteId: q.id } });
    expect(fotos).toHaveLength(1);
    expect(fotos[0]).toMatchObject({ motivo: 'archivado', pagado: 95_000, saldo: 0, seRealizo: true });

    await registrarCargo(
      prisma,
      q.id,
      { producto: 'horaExtra', cantidad: 2, precioUnitario: 4_750, fecha: '2026-08-11' },
      admin,
    );
    const ultima = await prisma.eventoHistorico.findFirstOrThrow({ where: { quoteId: q.id }, orderBy: { version: 'desc' } });
    expect(ultima.version).toBe(2);
    const foto = ultima.foto as { cargos?: { total: number }[]; cuentaCargos?: { saldo: number } };
    expect(foto.cargos?.map((c) => c.total)).toEqual([9_500]);
    expect(foto.cuentaCargos?.saldo).toBe(9_500);
  });

  it('un evento sin cargos no gana una versión nueva por el campo de cargos', async () => {
    const ev = eventoBI({ fechaEvento: '2026-09-08' });
    await importarLote(prisma, { eventos: [ev] });
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    expect(await archivarEvento(prisma, q.id)).toMatchObject({ motivo: 'sin-cambios', version: 1 });
  });
});

describe('sin corte de fecha', () => {
  // "El corte que no sea 1ero de agosto para el BI, no le pongas corte, que pueda
  // subir lo que sea" (el dueño, 5-oct-2026). Martes de 2018: en el dev no hay
  // nada ese día.
  it('un evento de hace años entra y queda en el Histórico', async () => {
    const ev = eventoBI({ fechaEvento: '2018-05-15', fechaContratacion: '2017-11-03', pagos: [] });
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]).toMatchObject({ estado: 'nuevo', accion: 'creado' });
    expect(r).not.toHaveProperty('corte');
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    expect(q.folio).toMatch(/^17NOV-\d{4,}$/);
    expect(await prisma.eventoHistorico.count({ where: { quoteId: q.id } })).toBe(1);
  });

  it('reconoce Primera comunión, Sesión de fotos y Otros, que el BI usa seguido', async () => {
    const r = await conciliarLote(prisma, {
      eventos: [
        eventoBI({ tipoEvento: 'Primera Comunión' }),
        eventoBI({ tipoEvento: 'SESION DE FOTOS' }),
        eventoBI({ tipoEvento: 'otros' }),
      ],
    });
    expect(r.resultados.map((x) => x.estado)).toEqual(['nuevo', 'nuevo', 'nuevo']);
  });
});

describe('lo que no se importa', () => {

  it('un salón que no se reconoce no se adivina', async () => {
    const r = await importarLote(prisma, { eventos: [eventoBI({ salones: ['Terraza'] })] });
    expect(r.resultados[0]).toMatchObject({ estado: 'invalido' });
    expect(r.resultados[0]!.errores![0]).toContain('Terraza');
  });

  it('formas que no suman el pago lo invalidan antes de escribir nada', async () => {
    const ev = eventoBI({ pagos: [{ folio: 5200, fecha: '2026-03-01', monto: 100, formas: [{ forma: 'efectivo', monto: 90 }] }] });
    const r = await importarLote(prisma, { eventos: [ev] });
    expect(r.resultados[0]!.estado).toBe('invalido');
    expect(await prisma.quote.count({ where: { importadoBI: ev.idBI } })).toBe(0);
  });
});

describe('conciliar contra lo que ya está aquí', () => {
  async function eventoNativo(fecha: string) {
    const q = await createQuote(
      prisma,
      { fecha, invitados: 220, spaceIds: [arcosId], eventTypeId: (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id, client: { telefono: '5555550000', nombre: 'Capturado Aquí' } },
      admin,
    );
    quotesNativas.push(q.id);
    return q;
  }

  it('misma fecha y salón que uno de aquí: posible duplicado, no se importa; con folioHSA se liga y se reportan las diferencias', async () => {
    const ev = eventoBI();
    const nativo = await eventoNativo(ev.fechaEvento);
    await registerPayment(prisma, storage, nativo.id, { monto: 20_000, metodo: 'transferencia', fecha: '2026-02-02' }, admin);
    // El folio real del pago capturado aquí, para que coincida con el del BI.
    const pagoAqui = await prisma.payment.findFirstOrThrow({ where: { quoteId: nativo.id } });

    const primero = await importarLote(prisma, { eventos: [ev] });
    expect(primero.resultados[0]!.estado).toBe('posibleDuplicado');
    expect(primero.resultados[0]!.candidatos![0]).toMatchObject({ tipo: 'evento', folio: nativo.folio });
    expect(await prisma.quote.count({ where: { importadoBI: ev.idBI } })).toBe(0);

    const ligado = await importarLote(prisma, {
      eventos: [{ ...ev, folioHSA: nativo.folio, pagos: [{ folio: pagoAqui.folio, fecha: '2026-02-02', monto: 20_000, metodo: 'transferencia' }] }],
    });
    expect(ligado.resultados[0]).toMatchObject({ accion: 'ligado', folioHSA: nativo.folio, estado: 'difiere' });
    // Nada se pisó: el nativo conserva su precio y sus datos.
    const q = await prisma.quote.findUniqueOrThrow({ where: { id: nativo.id } });
    expect(q.importadoBI).toBe(ev.idBI);
    expect(q.rentaTotal).toBe(nativo.rentaTotal);
    const campos = ligado.resultados[0]!.diferencias!.map((d) => d.campo);
    expect(campos).toContain('rentaTotal');
    expect(campos).not.toContain('folios');
    expect(campos).not.toContain('pagado');
  });

  it('los pagos de aquí posteriores al corte de pagos del BI no descuadran', async () => {
    const ev = eventoBI();
    await importarLote(prisma, { eventos: [ev] });
    const q = await prisma.quote.findUniqueOrThrow({ where: { importadoBI: ev.idBI } });
    await registerPayment(prisma, storage, q.id, { monto: 5_000, metodo: 'efectivo', fecha: '2026-09-20' }, admin);

    const sinVentana = await conciliarLote(prisma, { eventos: [ev] });
    expect(sinVentana.resultados[0]!.estado).toBe('difiere');
    const conVentana = await conciliarLote(prisma, { eventos: [ev], pagosHasta: '2026-08-31' });
    expect(conVentana.resultados[0]!.estado).toBe('igual');
  });

  it('con completo=true reporta los eventos de aquí que el BI no mandó', async () => {
    const soloAqui = await eventoNativo(siguienteSabado());
    await registerPayment(prisma, storage, soloAqui.id, { monto: 20_000, metodo: 'transferencia', fecha: '2026-09-01' }, admin);
    const r = await conciliarLote(prisma, { eventos: [eventoBI()], completo: true });
    expect(r.soloEnHSA!.map((x) => x.folioHSA)).toContain(soloAqui.folio);
    const parcial = await conciliarLote(prisma, { eventos: [eventoBI()] });
    expect(parcial.soloEnHSA).toBeUndefined();
  });
});

describe('las rutas', () => {
  // Toda ruta de escritura del BI va aquí: la de lectura no abre ninguna.
  const RUTAS_DE_ESCRITURA = ['/api/bi/importar/eventos', '/api/bi/conciliar', '/api/bi/importar/banqueteros', '/api/bi/conciliar/banqueteros'];

  it('la llave de LECTURA no abre la importación', async () => {
    for (const url of RUTAS_DE_ESCRITURA) {
      const r = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-api-key': LLAVE_LEER },
        payload: { eventos: [eventoBI()], banqueteros: [{ nombre: 'No debe entrar' }] },
      });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('con la llave de importación responde el reporte', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/bi/conciliar',
      headers: { 'x-api-key': LLAVE_IMPORTAR },
      payload: { eventos: [eventoBI()] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados[0].estado).toBe('nuevo');
  });

  it('un lote mal formado es 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/bi/importar/eventos',
      headers: { 'x-api-key': LLAVE_IMPORTAR },
      payload: { eventos: [] },
    });
    expect(r.statusCode).toBe(400);
  });

  it('sin BI_IMPORT_API_KEY las rutas no existen', async () => {
    const sin = await buildServer({ config: { ...loadConfig(), BI_API_KEY: LLAVE_LEER, BI_IMPORT_API_KEY: undefined } });
    await sin.ready();
    for (const url of RUTAS_DE_ESCRITURA) {
      const r = await sin.inject({
        method: 'POST',
        url,
        headers: { 'x-api-key': LLAVE_IMPORTAR },
        payload: { eventos: [eventoBI()], banqueteros: [{ nombre: 'No debe entrar' }] },
      });
      expect(r.statusCode, url).toBe(404);
    }
    await sin.close();
  });
});
