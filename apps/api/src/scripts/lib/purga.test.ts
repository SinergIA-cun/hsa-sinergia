import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@hsa/database';
import { censo, purgar, SECUENCIAS, TABLAS_CATALOGO, TABLAS_MOVIMIENTO } from './purga.js';
import { borrarRespaldo, crearRespaldo, listarRespaldos, restaurar } from './respaldo.js';

/** Lo mismo que respalda `purgar-datos.ts`: la bitácora PRIMERO. */
const TABLAS_RESPALDO = ['AuditoriaDb', ...TABLAS_MOVIMIENTO] as const;

/**
 * La purga borra todo, así que esta prueba NO puede correr contra la base de
 * desarrollo: se llevaría los datos con los que se trabaja todos los días.
 *
 * Por eso exige una base cuyo nombre termine en `_lab`. Si no, se salta con un
 * mensaje que dice cómo crearla:
 *
 *   docker exec hsa-postgres psql -U hsa -d postgres -c 'CREATE DATABASE hsa_purga_lab'
 *   DATABASE_URL="postgresql://hsa:hsa@localhost:5434/hsa_purga_lab?schema=public" \
 *     pnpm --filter @hsa/database exec prisma migrate deploy
 *   DATABASE_URL="postgresql://hsa:hsa@localhost:5434/hsa_purga_lab?schema=public" \
 *     pnpm --filter @hsa/api exec vitest run src/scripts/lib/purga.test.ts
 */
let base = '';
let esLab = false;

beforeAll(async () => {
  const r = await prisma.$queryRaw<{ base: string }[]>`SELECT current_database() AS base`;
  base = r[0]!.base;
  esLab = base.endsWith('_lab');
  if (!esLab) {
    console.warn(
      `\n[purga.test] Salteada: la base conectada es "${base}" y no termina en "_lab".\n` +
        '            Lee el encabezado del archivo para crear la base de pruebas.\n',
    );
  }
});

describe.runIf(process.env.DATABASE_URL?.includes('_lab'))('purga', () => {
  /** Catálogo mínimo + un evento completo con dinero encima. */
  async function sembrarMovimiento(): Promise<void> {
    const priceList = await prisma.priceList.create({
      data: { nombre: 'Lab', anio: 2027, activa: true, ivaRate: 0.16, extraHourRate: 0.05, foodDiscountRate: 0.05, capillaSabado: 5000 },
    });
    const space = await prisma.space.create({ data: { nombre: 'Salón Lab', capacidadMax: 400 } });
    await prisma.rentalPrice.create({
      data: { priceListId: priceList.id, spaceId: space.id, min: 1, max: 400, viernes: 1000, viernesEspecial: 500, sabado: 1200, domAJue: 900 },
    });
    const eventType = await prisma.eventType.create({ data: { nombre: 'Boda Lab', slug: 'boda-lab' } });
    const user = await prisma.user.create({
      data: { nombre: 'Admin Lab', email: 'lab@hsa.test', passwordHash: 'x', role: 'admin' },
    });
    const banquetero = await prisma.banquetero.create({ data: { nombre: 'Banquetero Lab', telefono: '9990000000' } });
    await prisma.empleado.create({ data: { nombre: 'Empleado Lab' } });

    const client = await prisma.client.create({ data: { nombre: 'Cliente Lab', telefono: '9991111111' } });
    const quote = await prisma.quote.create({
      data: {
        clientId: client.id,
        eventTypeId: eventType.id,
        priceListId: priceList.id,
        fechaEvento: new Date('2027-05-08T00:00:00.000Z'),
        invitados: 200,
        spaceIds: [space.id],
        horasExtra: 0,
        requiereFactura: false,
        total: 100_000,
        rentaTotal: 100_000,
        breakdown: [],
        addOns: [],
        codigo: '08MAY27-CLAB-LAB',
        publicToken: 'lab'.padEnd(32, '0'),
        status: 'formalizada',
      },
    });
    await prisma.quoteExtra.create({ data: { quoteId: quote.id, nombre: 'Extra Lab', kind: 'fijo', monto: 500 } });
    const deposito = await prisma.pagoBanquetero.create({
      data: { banqueteroId: banquetero.id, monto: 50_000, metodo: 'transferencia', fecha: new Date('2027-01-10T00:00:00.000Z') },
    });
    await prisma.payment.create({
      data: { quoteId: quote.id, monto: 30_000, metodo: 'transferencia', fecha: new Date('2027-01-10T00:00:00.000Z'), concepto: 'anticipo', pagoBanqueteroId: deposito.id },
    });
    const apartado = await prisma.apartadoFecha.create({
      data: { banqueteroId: banquetero.id, fechaEvento: new Date('2029-08-18T00:00:00.000Z'), spaceIds: [space.id], vence: new Date('2028-01-01T00:00:00.000Z') },
    });
    await prisma.abonoApartado.create({
      data: { apartadoId: apartado.id, monto: 20_000, metodo: 'transferencia', fecha: new Date('2027-04-10T00:00:00.000Z'), pagoBanqueteroId: deposito.id },
    });
    await prisma.activityLog.create({ data: { quoteId: quote.id, tipo: 'creada', descripcion: 'Lab', actorId: user.id } });
    await prisma.eventoHistorico.create({
      data: {
        quoteId: quote.id, version: 1, motivo: 'archivado', fechaEvento: quote.fechaEvento,
        codigo: quote.codigo, foto: {}, cliente: 'Cliente Lab', eventoTipo: 'Boda Lab',
        espacios: ['Salón Lab'], total: 100_000, pagado: 30_000, saldo: 70_000,
        seRealizo: true, liquidado: false, busqueda: 'cliente lab',
      },
    });
    await prisma.priceListAudit.create({
      data: { priceListId: priceList.id, tipo: 'renta', descripcion: 'Cambio de prueba' },
    });
  }

  /**
   * Cada prueba arranca de una base COMPLETAMENTE vacía y vuelve a sembrar: si
   * arrancaran del estado que dejó la anterior, el catálogo sobreviviente haría
   * choocar los nombres únicos y la prueba dejaría de poder repetirse.
   */
  async function desdeCero(): Promise<void> {
    await purgar(prisma, { motivo: 'preparación de la prueba', incluirCatalogo: true });
    await sembrarMovimiento();
  }

  beforeAll(desdeCero);

  it('el TRUNCATE cubre TODA la cerradura de llaves foráneas del movimiento', async () => {
    // Si faltara una tabla que apunta a otra de la lista, Postgres truena aquí
    // en vez de dejar filas huérfanas. Es la prueba de que la lista está completa.
    const antes = await censo(prisma, TABLAS_MOVIMIENTO);
    expect(antes.every((c) => c.filas > 0)).toBe(true);

    await expect(purgar(prisma, { motivo: 'prueba' })).resolves.toBeTruthy();

    const despues = await censo(prisma, TABLAS_MOVIMIENTO);
    expect(despues.filter((c) => c.filas > 0)).toEqual([]);
  });

  it('el catálogo y la gente sobreviven', async () => {
    await desdeCero();
    const catalogoAntes = await censo(prisma, TABLAS_CATALOGO);
    await purgar(prisma, { motivo: 'prueba' });
    expect(await censo(prisma, TABLAS_CATALOGO)).toEqual(catalogoAntes);
  });

  it('con incluirCatalogo, tampoco sobrevive el catálogo', async () => {
    await desdeCero();
    await purgar(prisma, { motivo: 'prueba', incluirCatalogo: true });
    const todo = await censo(prisma, [...TABLAS_MOVIMIENTO, ...TABLAS_CATALOGO]);
    expect(todo.filter((c) => c.filas > 0)).toEqual([]);
  });

  it('los folios de recibo y de cliente vuelven a empezar en 1', async () => {
    await desdeCero();
    // Quemar unos folios para que reiniciar signifique algo.
    for (const seq of SECUENCIAS) {
      await prisma.$executeRawUnsafe(`SELECT nextval('"${seq}"') FROM generate_series(1, 20)`);
    }
    await purgar(prisma, { motivo: 'prueba' });
    for (const seq of SECUENCIAS) {
      const r = await prisma.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('"${seq}"')::bigint AS v`);
      expect(Number(r[0]!.v)).toBe(1);
    }
  });

  it('la bitácora forense queda con UN renglón: el de la purga, con su censo', async () => {
    await desdeCero();
    await purgar(prisma, { motivo: 'entrega al cliente' });

    const filas = await prisma.$queryRaw<
      { tabla: string; operacion: string; despues: { motivo: string; filasPorTabla: Record<string, number> } }[]
    >`SELECT "tabla", "operacion", "despues" FROM "AuditoriaDb"`;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.operacion).toBe('PURGA');
    expect(filas[0]!.despues.motivo).toBe('entrega al cliente');
    // El censo dice cuántas filas se fueron de cada tabla.
    expect(filas[0]!.despues.filasPorTabla.Quote).toBe(1);
    expect(filas[0]!.despues.filasPorTabla.Payment).toBe(1);
  });

  it('la bitácora sigue siendo de solo escritura fuera de la purga', async () => {
    // El interruptor `app.purga_auditoria` es transaccional: la purga lo prende
    // dentro de su propia transacción y no queda abierto para el que sigue.
    await expect(prisma.$executeRaw`DELETE FROM "AuditoriaDb"`).rejects.toThrow(
      /no se edita ni se borra/,
    );
  });

  // ── Respaldo dentro de la misma base ──────────────────────────────────────
  // Existe porque `pg_dump` no está en la consola del contenedor de la API, así
  // que "respalda antes de vaciar" no se podía seguir. Las dos pruebas de abajo
  // cubren los dos errores que encontró la primera corrida contra una base real.

  it('el respaldo se copia entero y aparece en la lista', async () => {
    await desdeCero();
    const antes = await censo(prisma, TABLAS_RESPALDO);
    const r = await crearRespaldo(prisma, TABLAS_RESPALDO);

    expect(r.filas).toBe(antes.reduce((s, c) => s + c.filas, 0));
    expect((await listarRespaldos(prisma)).map((x) => x.esquema)).toContain(r.esquema);
    await borrarRespaldo(prisma, r.esquema);
  });

  it('purgar y restaurar devuelve exactamente lo que había', async () => {
    await desdeCero();
    const antes = await censo(prisma, TABLAS_MOVIMIENTO);
    const r = await crearRespaldo(prisma, TABLAS_RESPALDO);

    await purgar(prisma, { motivo: 'prueba' });
    expect((await censo(prisma, TABLAS_MOVIMIENTO)).filter((c) => c.filas > 0)).toEqual([]);

    // Aquí tronaba: insertaba hijos antes que padres y violaba las llaves
    // foráneas. La lista de tablas ahora va de padres a hijos.
    await restaurar(prisma, r.esquema, TABLAS_RESPALDO);
    expect(await censo(prisma, TABLAS_MOVIMIENTO)).toEqual(antes);
    await borrarRespaldo(prisma, r.esquema);
  });

  it('al restaurar, el siguiente folio queda POR ENCIMA del último devuelto', async () => {
    await desdeCero();
    const r = await crearRespaldo(prisma, TABLAS_RESPALDO);
    const pagoAntes = await prisma.payment.findFirstOrThrow({ select: { folio: true } });

    await purgar(prisma, { motivo: 'prueba' });
    await restaurar(prisma, r.esquema, TABLAS_RESPALDO);

    const siguiente = await prisma.$queryRawUnsafe<{ v: bigint }[]>(
      `SELECT nextval('"recibo_folio_seq"')::bigint AS v`,
    );
    // Sin esto el siguiente recibo reestrenaría un folio ya impreso.
    expect(Number(siguiente[0]!.v)).toBeGreaterThan(pagoAntes.folio);
    await borrarRespaldo(prisma, r.esquema);
  });

  it('la bitácora restaurada no chooca con los renglones que deja el propio TRUNCATE', async () => {
    // El otro error de la primera corrida: el TRUNCATE dispara los triggers de
    // la bitácora, cada tabla truncada deja su renglón, y esos renglones se
    // quedaban con los ids 1, 2, 3… los mismos que traía el respaldo.
    await desdeCero();
    const bitacoraAntes = await censo(prisma, ['AuditoriaDb']);
    const r = await crearRespaldo(prisma, TABLAS_RESPALDO);

    await purgar(prisma, { motivo: 'prueba' });
    await expect(restaurar(prisma, r.esquema, TABLAS_RESPALDO)).resolves.toBeGreaterThan(0);

    // Vuelven los renglones del respaldo; los que agrega la restauración misma
    // son de más, no de menos.
    const despues = await censo(prisma, ['AuditoriaDb']);
    expect(despues[0]!.filas).toBeGreaterThanOrEqual(bitacoraAntes[0]!.filas);
    await borrarRespaldo(prisma, r.esquema);
  });

  it('un respaldo que no existe truena sin tocar las tablas', async () => {
    await desdeCero();
    const antes = await censo(prisma, TABLAS_MOVIMIENTO);
    await expect(restaurar(prisma, 'respaldo_no_existe', TABLAS_RESPALDO)).rejects.toThrow(
      /No existe el respaldo/,
    );
    expect(await censo(prisma, TABLAS_MOVIMIENTO)).toEqual(antes);
  });

  it('borrarRespaldo se niega con un esquema que no es de respaldo', async () => {
    await expect(borrarRespaldo(prisma, 'public')).rejects.toThrow(/no parece un esquema de respaldo/);
  });
});
