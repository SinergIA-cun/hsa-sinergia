import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@hsa/database';
import { hoyCivilMexico } from '@hsa/shared';
import { buildServer } from '../server.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { createQuote, softDeleteQuote, type Actor } from '../quotes/service.js';
import { ServerStorage } from '../payments/storage.js';
import { registrarDeposito, asignarDeposito, anularAsignacion } from './cuenta.js';
import { crearApartado, cancelarApartado, convertirApartado } from './apartados.js';
import { estadoCuentaBanquetero, estadoCuentaPublico } from './estadoCuenta.js';

const storage = new ServerStorage(join(tmpdir(), 'hsa-ecb-test-' + randomUUID()));

let app: FastifyInstance;
let actor: Actor;
let arcosId: string;
let eventTypeId: string;
/** El banquetero de la prueba grande: tres eventos y un depósito de 323,345. */
let ramirezId: string;
/** Uno intacto, para el caso "sin nada devuelve ceros". */
let vacioId: string;
/** Un tercero, para probar que el enlace público no filtra al vecino. */
let vecinoId: string;
const ventasEmail = `ventas-ecb-${randomUUID()}@haciendasanandres.com.mx`;
let ventasId: string;
const quotes: string[] = [];
const clients: string[] = [];
const banqueteros: string[] = [];

const PRIMER_SABADO = '2034-01-07';
let sabadoSeq = 0;
function siguienteSabado(): string {
  const [y, m, d] = PRIMER_SABADO.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + 7 * sabadoSeq++);
  return fecha.toISOString().slice(0, 10);
}

async function evento(deQuien: string, nombre: string) {
  const q = await createQuote(
    prisma,
    {
      fecha: siguienteSabado(),
      invitados: 250,
      spaceIds: [arcosId],
      eventTypeId,
      banqueteroId: deQuien,
      festejado: nombre,
      client: { telefono: '5555550000', nombre: 'Cliente del banquetero' },
    },
    actor,
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
}

beforeAll(async () => {
  app = await buildServer({ config: loadConfig() });
  await app.ready();
  const admin = await prisma.user.findUnique({ where: { email: 'admin@haciendasanandres.com.mx' } });
  actor = { id: admin!.id, role: 'admin' };
  const v = await prisma.user.create({
    data: {
      nombre: 'Vendedora de estados de cuenta',
      email: ventasEmail,
      passwordHash: await hashPassword('ventas1234'),
      role: 'ventas',
    },
  });
  ventasId = v.id;
  arcosId = (await prisma.space.findFirst({ where: { nombre: 'Arcos' } }))!.id;
  eventTypeId = (await prisma.eventType.findFirst({ where: { slug: 'boda' } }))!.id;
  const [r, vac, vec] = await Promise.all([
    prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Ramírez EC ${randomUUID().slice(0, 6)}` } }),
    prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Vacío EC ${randomUUID().slice(0, 6)}` } }),
    prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Vecino EC ${randomUUID().slice(0, 6)}` } }),
  ]);
  ramirezId = r.id;
  vacioId = vac.id;
  vecinoId = vec.id;
  banqueteros.push(r.id, vac.id, vec.id);
});

afterAll(async () => {
  await prisma.apartadoFecha.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.payment.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  await prisma.pagoBanquetero.deleteMany({ where: { banqueteroId: { in: banqueteros } } });
  await prisma.banquetero.deleteMany({ where: { id: { in: banqueteros } } });
  await prisma.user.delete({ where: { id: ventasId } });
  await app.close();
});

async function cookies(email: string, password: string) {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const c = login.cookies[0]!;
  return { [c.name]: c.value };
}

describe('estado de cuenta del banquetero', () => {
  /**
   * LA PRUEBA QUE DA SENTIDO AL PLAN, en los números del dueño: un depósito de
   * $323,345 y tres eventos; 55,000 / 55,000 / el resto.
   */
  it('el reparto de 323,345 entre tres eventos cuadra en el estado de cuenta', async () => {
    const [a, b, c] = [
      await evento(ramirezId, 'Generación A'),
      await evento(ramirezId, 'Generación B'),
      await evento(ramirezId, 'Generación C'),
    ];
    const dep = await registrarDeposito(
      prisma,
      storage,
      ramirezId,
      { monto: 323_345, metodo: 'transferencia', fecha: '2026-03-05', referencia: 'SPEI grande' },
      actor,
    );
    await asignarDeposito(
      prisma,
      storage,
      dep.id,
      {
        asignaciones: [
          { quoteId: a.id, monto: 55_000 },
          { quoteId: b.id, monto: 55_000 },
          { quoteId: c.id, monto: 213_345 },
        ],
      },
      actor,
    );

    const ec = await estadoCuentaBanquetero(prisma, ramirezId);
    expect(ec.totales.eventos).toBe(3);
    expect(ec.totales.depositado).toBe(323_345);
    expect(ec.totales.saldoSinAsignar).toBe(0);
    expect(ec.totales.pagado).toBe(323_345);

    const porFestejado = new Map(ec.eventos.map((e) => [e.festejado, e]));
    expect(porFestejado.get('Generación A')!.pagado).toBe(55_000);
    expect(porFestejado.get('Generación B')!.pagado).toBe(55_000);
    expect(porFestejado.get('Generación C')!.pagado).toBe(213_345);
    // Tres aplicaciones del mismo depósito, y las tres llevan SU folio: es una
    // sola entrada de dinero, así que es un solo número en la hoja foliada.
    expect(ec.depositos[0]!.asignaciones).toHaveLength(3);
    expect(new Set(ec.depositos[0]!.asignaciones.map((x) => x.folio)).size).toBe(1);
  });

  it('el saldo sin asignar es Σ depósitos vivos − Σ asignaciones vivas', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Saldos ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const uno = await evento(b.id, 'Uno');

    const d1 = await registrarDeposito(prisma, storage, b.id, { monto: 100_000, metodo: 'efectivo', fecha: '2026-03-05' }, actor);
    const d2 = await registrarDeposito(prisma, storage, b.id, { monto: 58_345, metodo: 'transferencia', fecha: '2026-04-01' }, actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(158_345);

    const { pagos } = await asignarDeposito(prisma, storage, d1.id, { asignaciones: [{ quoteId: uno.id, monto: 40_000 }] }, actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(118_345);

    // Anular la asignación devuelve el monto al saldo.
    await anularAsignacion(prisma, d1.id, pagos[0]!.paymentId, 'iba a otro evento', actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoSinAsignar).toBe(158_345);

    // Y un depósito anulado deja de sumar.
    await asignarDeposito(prisma, storage, d1.id, { asignaciones: [{ quoteId: uno.id, monto: 100_000 }] }, actor);
    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.totales.saldoSinAsignar).toBe(58_345);
    expect(ec.totales.depositado).toBe(158_345);
    void d2;
  });

  it('un banquetero sin nada devuelve ceros, no un error', async () => {
    const ec = await estadoCuentaBanquetero(prisma, vacioId);
    expect(ec.eventos).toEqual([]);
    expect(ec.depositos).toEqual([]);
    expect(ec.apartados).toEqual([]);
    expect(ec.totales).toMatchObject({
      eventos: 0,
      rentaTotal: 0,
      pagado: 0,
      saldo: 0,
      depositado: 0,
      saldoSinAsignar: 0,
      saldoAFavor: 0,
      saldoLiberado: 0,
      apartadosVivos: 0,
      apartadosPorVencer: 0,
    });
  });

  it('un banquetero que no existe da 404', async () => {
    await expect(estadoCuentaBanquetero(prisma, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('las cotizaciones en la papelera NO aparecen', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Papelera ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const viva = await evento(b.id, 'Viva');
    const muerta = await evento(b.id, 'A la papelera');
    await softDeleteQuote(prisma, muerta.id, actor);

    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.eventos.map((e) => e.quoteId)).toEqual([viva.id]);
    expect(ec.totales.eventos).toBe(1);
  });

  it('trae los apartados y los que vencen en los próximos 30 días', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Vence ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    /*
     * Las fechas salen del reloj y NO de constantes, para que la prueba no sea
     * una bomba de tiempo que truene sola al llegar esa fecha.
     *
     * El plazo se escribe en la base porque `crearApartado` ya no lo recibe: son
     * siete días hábiles y punto. Lo que se prueba aquí es la VENTANA de 30 días
     * del estado de cuenta, que necesita un apartado dentro y otro fuera — y con
     * el plazo de la casa los dos caerían dentro.
     */
    const hoy = hoyCivilMexico();
    const enDias = (n: number): string =>
      new Date(hoy.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const cerca = enDias(10); // dentro de la ventana de 30 días
    const lejos = enDias(300); // fuera de la ventana

    const a1 = await crearApartado(prisma, b.id, { fechaEvento: siguienteSabado(), spaceIds: [arcosId] }, actor);
    const a2 = await crearApartado(prisma, b.id, { fechaEvento: siguienteSabado(), spaceIds: [arcosId] }, actor);
    await prisma.apartadoFecha.update({ where: { id: a1.apartado.id }, data: { vence: new Date(`${cerca}T00:00:00.000Z`) } });
    await prisma.apartadoFecha.update({ where: { id: a2.apartado.id }, data: { vence: new Date(`${lejos}T00:00:00.000Z`) } });

    const ec = await estadoCuentaBanquetero(prisma, b.id, { hoy });
    expect(ec.apartados).toHaveLength(2);
    expect(ec.totales.apartadosVivos).toBe(2);
    // Solo el cercano entra en la ventana de 30 días.
    expect(ec.totales.apartadosPorVencer).toBe(1);
    expect(ec.apartadosPorVencer[0]!.vence.toISOString()).toBe(`${cerca}T00:00:00.000Z`);
    // Y el apartado NO suma a la renta comprometida: no tiene total.
    expect(ec.totales.rentaTotal).toBe(0);
  });

  it('GET /banqueteros/:id/estado-cuenta: admin y ventas sí, anónimo 401', async () => {
    const anon = await app.inject({ method: 'GET', url: `/api/banqueteros/${ramirezId}/estado-cuenta` });
    expect(anon.statusCode).toBe(401);

    for (const c of [
      await cookies('admin@haciendasanandres.com.mx', 'admin1234'),
      await cookies(ventasEmail, 'ventas1234'),
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/banqueteros/${ramirezId}/estado-cuenta`, cookies: c });
      expect(res.statusCode).toBe(200);
      expect(res.json().totales.eventos).toBe(3);
    }
  });
});

describe('el enlace compartible de solo lectura', () => {
  it('cada banquetero nace con su token de 32 caracteres, distinto del vecino', async () => {
    const [r, v] = await Promise.all([
      prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } }),
      prisma.banquetero.findUniqueOrThrow({ where: { id: vecinoId } }),
    ]);
    expect(r.publicToken).toHaveLength(32);
    expect(r.publicToken).not.toBe(v.publicToken);
  });

  it('GET /b/:token sirve el estado de cuenta SIN sesión', async () => {
    const r = await prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } });
    const res = await app.inject({ method: 'GET', url: `/api/b/${r.publicToken}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.banquetero.nombre).toContain('Ramírez EC');
    expect(body.eventos).toHaveLength(3);
    // `saldoSinAsignar` dejó de publicarse: el portal habla de saldo A FAVOR,
    // que es lo mismo visto desde el banquetero y sin contar depósitos.
    expect(body.totales.saldoSinAsignar).toBeUndefined();
    expect(body.totales.saldoAFavor).toBe(0);
    expect(body.totales.saldoPorCubrir).toBe(body.eventos.reduce((s: number, e: { saldo: number }) => s + e.saldo, 0));
  });

  it('un token inválido da 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/b/no-existe' })).statusCode).toBe(404);
    expect(await estadoCuentaPublico(prisma, 'no-existe')).toBeNull();
  });

  it('el token de uno NO expone los datos de otro', async () => {
    const vecinoEvento = await evento(vecinoId, 'Evento del vecino');
    const r = await prisma.banquetero.findUniqueOrThrow({ where: { id: ramirezId } });
    const publico = await estadoCuentaPublico(prisma, r.publicToken);

    expect(publico!.banquetero.nombre).toContain('Ramírez EC');
    expect(publico!.eventos.map((e) => e.festejado)).not.toContain('Evento del vecino');
    // Y por el otro token se ve exactamente lo del otro, nada más.
    const v = await prisma.banquetero.findUniqueOrThrow({ where: { id: vecinoId } });
    const delVecino = await estadoCuentaPublico(prisma, v.publicToken);
    expect(delVecino!.eventos.map((e) => e.festejado)).toEqual(['Evento del vecino']);
    void vecinoEvento;
  });

  it('la vista pública es una proyección: no filtra comprobantes, actores ni motivos', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Proyección ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const q = await evento(b.id, 'Proyectado');
    const dep = await registrarDeposito(
      prisma,
      storage,
      b.id,
      { monto: 50_000, metodo: 'transferencia', fecha: '2026-03-05', referencia: 'SPEI 1' },
      actor,
      { data: Buffer.from('ficha'), mime: 'image/jpeg' },
    );
    const { pagos } = await asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: q.id, monto: 20_000 }] }, actor);
    await anularAsignacion(prisma, dep.id, pagos[0]!.paymentId, 'motivo interno que no se publica', actor);

    const token = (await prisma.banquetero.findUniqueOrThrow({ where: { id: b.id } })).publicToken;
    const publico = await estadoCuentaPublico(prisma, token);
    const json = JSON.stringify(publico);

    expect(json).not.toContain('comprobanteKey');
    expect(json).not.toContain(dep.comprobanteKey!);
    expect(json).not.toContain('registradoById');
    expect(json).not.toContain('motivo interno que no se publica');
    expect(json).not.toContain(actor.id);
    // El depósito completo dejó de publicarse: ni el monto, ni su referencia, ni
    // cómo se repartió. El saldo a favor sí, porque es dinero suyo.
    expect(json).not.toContain('depositos');
    expect(publico!.totales.saldoAFavor).toBe(50_000);
  });

  it('un depósito anulado no le sube el saldo a favor a nadie', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Anulado ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const dep = await registrarDeposito(prisma, storage, b.id, { monto: 10_000, metodo: 'efectivo', fecha: '2026-03-05' }, actor);
    await prisma.pagoBanquetero.update({ where: { id: dep.id }, data: { anuladoAt: new Date() } });

    const token = (await prisma.banquetero.findUniqueOrThrow({ where: { id: b.id } })).publicToken;
    const publico = await estadoCuentaPublico(prisma, token);
    expect(publico!.totales.saldoAFavor).toBe(0);
  });

  it('el portal NO deja ver cuánto deposita el banquetero al año', async () => {
    /*
     * Decisión del dueño, y es de confidencialidad, no de diseño: la lista de
     * depósitos deja ver de un vistazo cuánto factura la hacienda con este
     * banquetero, y ése es un número de la casa.
     *
     * Se revisa sobre el JSON COMPLETO y no sobre las llaves que se esperan:
     * antes `totales` se pasaba entero desde el objeto interno, así que cualquier
     * campo nuevo se publicaba solo. Lo que esta prueba cuida es que no vuelva a
     * pasar — por eso también busca el monto suelto, no solo el nombre del campo.
     */
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Privado ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const q = await evento(b.id, 'Del privado');
    const dep = await registrarDeposito(prisma, storage, b.id, { monto: 1_234_567, metodo: 'transferencia', fecha: '2026-03-05', referencia: 'SPEI-PRIVADO' }, actor);
    await registrarDeposito(prisma, storage, b.id, { monto: 890_000, metodo: 'transferencia', fecha: '2026-04-05' }, actor);
    // Parte ya repartida, que es el caso real: así el histórico depositado
    // (2,124,567) y el saldo a favor (2,000,000) son números DISTINTOS y se
    // puede afirmar que uno sale y el otro no.
    await asignarDeposito(prisma, storage, dep.id, { asignaciones: [{ quoteId: q.id, monto: 124_567 }] }, actor);

    const token = (await prisma.banquetero.findUniqueOrThrow({ where: { id: b.id } })).publicToken;
    const publico = await estadoCuentaPublico(prisma, token);
    const json = JSON.stringify(publico);

    expect(json).not.toContain('depositos');
    expect(json).not.toContain('depositado');
    expect(json).not.toContain('SPEI-PRIVADO');
    // Ni el total histórico ni ningún depósito por separado.
    expect(json).not.toContain('2124567');
    expect(json).not.toContain('1234567');
    expect(json).not.toContain('890000');
    // Su saldo a favor sí: es dinero suyo y es de lo que se discute.
    expect(publico!.totales.saldoAFavor).toBe(2_000_000);
  });
});

describe('el dinero de una fecha que se soltó vuelve como saldo a favor', () => {
  /*
   * Regla del dueño: "si le hiciste algún tipo de aportación se pasa como saldo
   * a favor del banquetero".
   *
   * Un apartado que venció o que se canceló ya no bloquea nada. Retenerle el
   * dinero contra una fecha que se le quitó sería cobrarle por aire. No se MUEVE
   * nada —no se crea un depósito, no se reescribe el abono—: el dinero entró el
   * día que entró y así se factura; lo único que cambia es contra qué está
   * apartado, y eso se calcula.
   */
  async function apartadoVencido(banqueteroId: string, deposito: number) {
    const { apartado } = await crearApartado(
      prisma,
      banqueteroId,
      {
        fechaEvento: siguienteSabado(),
        spaceIds: [arcosId],
        deposito,
        depositoMetodo: 'efectivo',
        depositoFecha: '2026-03-05',
      },
      actor,
    );
    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2020-01-01T00:00:00.000Z') },
    });
    return apartado;
  }

  it('un abono DIRECTO a una fecha vencida se vuelve saldo a favor', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Vencio ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);

    const apartado = await apartadoVencido(b.id, 30_000);
    // Antes de vencer no era saldo a favor: estaba comprometido con esa fecha.
    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2035-01-01T00:00:00.000Z') },
    });
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoAFavor).toBe(0);

    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2020-01-01T00:00:00.000Z') },
    });
    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.totales.saldoLiberado).toBe(30_000);
    expect(ec.totales.saldoAFavor).toBe(30_000);
  });

  it('cancelar la fecha libera el dinero igual que dejarla vencer', async () => {
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Cancelo ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const { apartado } = await crearApartado(
      prisma,
      b.id,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], deposito: 25_000, depositoMetodo: 'efectivo', depositoFecha: '2026-03-05' },
      actor,
    );
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoAFavor).toBe(0);

    await cancelarApartado(prisma, apartado.id, { motivo: 'ya no lo quiso' }, actor);
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoAFavor).toBe(25_000);
  });

  it('un abono que salió de un DEPÓSITO vuelve al saldo de su depósito, sin duplicarse', async () => {
    /*
     * Éste es el que se puede contar dos veces. El dinero ya estaba en un
     * depósito, así que al soltarse la fecha NO nace saldo nuevo: simplemente el
     * depósito vuelve a tenerlo sin repartir. Si además se contara como liberado,
     * el banquetero aparecería con el doble de dinero del que dio.
     */
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Desde dep ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const dep = await registrarDeposito(prisma, storage, b.id, { monto: 100_000, metodo: 'transferencia', fecha: '2026-03-05' }, actor);
    const { apartado } = await crearApartado(prisma, b.id, { fechaEvento: siguienteSabado(), spaceIds: [arcosId] }, actor);
    await asignarDeposito(prisma, storage, dep.id, { apartados: [{ apartadoId: apartado.id, monto: 40_000 }] }, actor);

    // Comprometido con la fecha: al banquetero le quedan 60 mil disponibles.
    expect((await estadoCuentaBanquetero(prisma, b.id)).totales.saldoAFavor).toBe(60_000);

    await prisma.apartadoFecha.update({
      where: { id: apartado.id },
      data: { vence: new Date('2020-01-01T00:00:00.000Z') },
    });
    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.totales.saldoAFavor).toBe(100_000);
    // Y NO se contó por los dos lados: lo liberado va en cero porque el dinero
    // volvió por su depósito.
    expect(ec.totales.saldoLiberado).toBe(0);
    expect(ec.totales.saldoSinAsignar).toBe(100_000);
  });

  it('una fecha CONVERTIDA no libera nada: su dinero es del contrato', async () => {
    // El apartado convertido tampoco está vivo, pero su dinero ya se volvió pago
    // de la cotización. Contarlo como saldo a favor sería regalarlo dos veces.
    const b = await prisma.banquetero.create({ data: { telefono: '5555550000', nombre: `Convertido ${randomUUID().slice(0, 6)}` } });
    banqueteros.push(b.id);
    const { apartado } = await crearApartado(
      prisma,
      b.id,
      { fechaEvento: siguienteSabado(), spaceIds: [arcosId], deposito: 20_000, depositoMetodo: 'efectivo', depositoFecha: '2026-03-05' },
      actor,
    );
    const { quote } = await convertirApartado(prisma, storage, apartado.id, {
      invitados: 250,
      eventTypeId,
      client: { telefono: '5555550000', nombre: 'Cliente del convertido' },
    }, actor);
    quotes.push(quote.id);
    // La conversión crea la ficha del banquetero como cliente: también se limpia.
    clients.push(quote.clientId);

    const ec = await estadoCuentaBanquetero(prisma, b.id);
    expect(ec.totales.saldoLiberado).toBe(0);
    expect(ec.totales.saldoAFavor).toBe(0);
    // El dinero está donde debe: pagado en su evento.
    expect(ec.eventos.find((e) => e.quoteId === quote.id)!.pagado).toBe(20_000);
  });
});
