import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import {
  correoValido,
  hoyCivilMexico,
  vigenciaDeApartado,
  metodoCapturaSchema,
  formasPagoSchema,
  type PartePago,
  conRentaAcordada,
  type QuoteBreakdown,
} from '@hsa/shared';
import { INCLUDE_ABONOS, totalAbonado } from './abonos.js';
import { QuoteError, createQuote, type Actor } from '../quotes/service.js';
import { logActivity } from '../quotes/activityLog.js';
import { getAvailability } from '../availability/service.js';
import { registerPayment, resolverOError } from '../payments/service.js';
import type { ComprobanteStorage } from '../payments/storage.js';

/**
 * Apartar una fecha SIN precio.
 *
 * El caso 3 del dueño: los banqueteros son los que más graduaciones venden,
 * piden fechas muy adelantadas —hoy 2028— y pagan la fecha sin que los precios
 * existan todavía. Hoy no cabe: `createQuote` exige un catálogo y calcula un
 * total.
 *
 * Un apartado bloquea la disponibilidad igual que un evento comprometido (es
 * dinero real sobre una fecha) pero **no tiene total**: no es una venta cerrada y
 * no aparece en ningún reporte de ingreso comprometido, que siguen leyendo
 * `Quote`.
 *
 * Este archivo NO toca el motor de precios: un apartado sin precio no pasa por
 * él, y una cotización convertida pasa exactamente como cualquier otra.
 */

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const apartadoSchema = z
  .object({
    fechaEvento: fechaISO,
    spaceIds: z.array(z.string().min(1)).min(1),
    /** El catálogo con precio garantizado, si se negoció uno. */
    priceListId: z.string().min(1).nullish(),
    // `int`: el depósito se captura. Prisma trunca los flotantes al escribir en
    // una columna `Int` sin avisar, así que un decimal se rechaza, no se redondea.
    deposito: z.number().int().nonnegative().default(0),
    depositoMetodo: metodoCapturaSchema.nullish(),
    /** El depósito dividido en varias formas. Ver `registerPaymentSchema`. */
    depositoFormas: formasPagoSchema.nullish(),
    /** Cuándo se RECIBIÓ el depósito (no cuándo se capturó ni cuándo se convierte). */
    depositoFecha: fechaISO.nullish(),
    /*
     * `vence` NO se captura. Antes era un campo del formulario y un plazo que
     * cada quien teclea no es un plazo: era una negociación por apartado,
     * imposible de sostener igual para todos. Ahora son siete días hábiles,
     * contados por `vigenciaDeApartado`, y quien aparta no puede moverlos.
     */
    nota: z.string().max(500).nullish(),
    /**
     * Apartar sobre una fecha ya comprometida AVISA, no bloquea: el mismo trato
     * que los empalmes. Sin `confirmar` la respuesta es 409 con el detalle del
     * choque; con `confirmar` procede y el empalme queda a la vista de todos.
     */
    confirmar: z.boolean().default(false),
  })
  .refine(
    (d) =>
      d.deposito === 0 ||
      ((d.depositoMetodo != null || (d.depositoFormas?.length ?? 0) > 0) && d.depositoFecha != null),
    {
    message: 'Un depósito necesita forma de pago y la fecha en que se recibió.',
    path: ['depositoMetodo'],
    },
  );

export const cancelarApartadoSchema = z.object({ motivo: z.string().min(3) });

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const INCLUDE = {
  banquetero: { select: { id: true, nombre: true, telefono: true } },
  client: { select: { id: true, nombre: true, telefono: true, correo: true } },
  eventType: { select: { id: true, nombre: true } },
  priceList: { select: { id: true, nombre: true, anio: true } },
  quote: { select: { id: true, folio: true, etiqueta: true, total: true, status: true } },
  ...INCLUDE_ABONOS,
} as const;

/** ¿Este apartado sigue bloqueando su fecha? Pura, para que el "hoy" se pueda fijar. */
export function apartadoVivo(
  a: { canceladoAt: Date | null; quoteId: string | null; vence: Date },
  hoy: Date = hoyCivilMexico(),
): boolean {
  return a.canceladoAt == null && a.quoteId == null && a.vence.getTime() >= hoy.getTime();
}

export async function crearApartado(
  db: PrismaClient,
  banqueteroId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const input = apartadoSchema.parse(rawInput);
  const banquetero = await db.banquetero.findUnique({ where: { id: banqueteroId }, select: { id: true } });
  if (!banquetero) throw new QuoteError(404, 'Banquetero no encontrado');
  if (input.priceListId) {
    const cat = await db.priceList.findUnique({ where: { id: input.priceListId }, select: { id: true } });
    if (!cat) throw new QuoteError(400, 'El catálogo elegido no existe.');
  }
  // Los espacios tienen que existir. Un apartado no pasa por el motor de precios,
  // que es quien truena con un `spaceId` inventado al cotizar: aquí nadie lo
  // atraparía y el apartado quedaría guardado bloqueando NADA — cobrado el
  // depósito y con la fecha libre para que alguien más la venda.
  const espacios = await db.space.findMany({ where: { id: { in: input.spaceIds } }, select: { id: true } });
  if (espacios.length !== new Set(input.spaceIds).size) {
    throw new QuoteError(400, 'Alguno de los espacios elegidos no existe.');
  }

  const hoy = hoyCivilMexico();
  /*
   * Siete días hábiles desde hoy. Ya no hay guardia de "nace vencido": con el
   * plazo calculado desde el día de hoy, nacer vencido dejó de ser posible.
   */
  const vence = vigenciaDeApartado(hoy);

  // Mismo trato que los empalmes: avisa, no bloquea. Sin `confirmar` no se
  // aparta a ciegas sobre una fecha comprometida; con él, procede.
  const disp = await getAvailability(db, input.fechaEvento, input.spaceIds);
  const choques = disp.spaces.filter((s) => s.level === 'bloqueada');
  if (choques.length > 0 && !input.confirmar) {
    throw new QuoteError(
      409,
      `${choques.map((s) => s.nombre).join(', ')} ya está comprometido el ${input.fechaEvento}. ` +
        'Confirma si de todos modos quieres apartar esa fecha.',
    );
  }

  const formaDeposito =
    input.deposito > 0
      ? resolverOError({ monto: input.deposito, metodo: input.depositoMetodo, formas: input.depositoFormas })
      : null;
  const apartado = await db.apartadoFecha.create({
    data: {
      banqueteroId,
      fechaEvento: dia(input.fechaEvento),
      spaceIds: input.spaceIds,
      priceListId: input.priceListId ?? null,
      vence,
      nota: input.nota ?? null,
      createdById: actor.id,
      // El depósito que se deja AL APARTAR es simplemente el primer abono. Se
      // captura junto con la fecha porque así llega ("apártame el 15 y te dejo
      // veinte mil"), pero se guarda como lo que es: una entrada de dinero más,
      // con su propia fecha de recepción.
      ...(input.deposito > 0 && formaDeposito && input.depositoFecha
        ? {
            abonos: {
              create: [
                {
                  monto: input.deposito,
                  metodo: formaDeposito.metodo,
                  formas: formaDeposito.formas ?? undefined,
                  fecha: dia(input.depositoFecha),
                  referencia: 'Depósito al apartar',
                  registradoById: actor.id,
                },
              ],
            },
          }
        : {}),
    },
    include: INCLUDE,
  });
  return { apartado, avisos: choques.map((s) => ({ spaceId: s.spaceId, nombre: s.nombre })) };
}

/** Los apartados de un banquetero, del más próximo al más lejano. */
export async function listarApartados(
  db: PrismaClient,
  banqueteroId: string,
  opts: { hoy?: Date } = {},
) {
  const apartados = await db.apartadoFecha.findMany({
    where: { banqueteroId },
    include: INCLUDE,
    orderBy: { fechaEvento: 'asc' },
  });
  const hoy = opts.hoy ?? hoyCivilMexico();
  return apartados.map((a) => ({
    ...a,
    // Lo que lleva juntado esta fecha. NO es un saldo pendiente: un apartado no
    // tiene precio, así que no hay contra qué restarlo.
    abonado: totalAbonado(a.abonos),
    vivo: apartadoVivo(a, hoy),
    vencido: a.canceladoAt == null && a.quoteId == null && a.vence.getTime() < hoy.getTime(),
  }));
}

/**
 * Un apartado por su id, con lo mismo que trae la lista. Es la ficha de los que
 * apartó un cliente directo, que no tienen un banquetero en cuya página vivir.
 */
export async function obtenerApartado(db: PrismaClient, apartadoId: string, opts: { hoy?: Date } = {}) {
  const a = await db.apartadoFecha.findUnique({ where: { id: apartadoId }, include: INCLUDE });
  if (!a) throw new QuoteError(404, 'Apartado no encontrado');
  const hoy = opts.hoy ?? hoyCivilMexico();
  return {
    ...a,
    abonado: totalAbonado(a.abonos),
    vivo: apartadoVivo(a, hoy),
    vencido: a.canceladoAt == null && a.quoteId == null && a.vence.getTime() < hoy.getTime(),
  };
}

export const renovarApartadoSchema = z.object({ confirmar: z.boolean().default(false) });

/**
 * Le da al apartado otros siete días hábiles, contados desde hoy.
 *
 * Existe porque el plazo dejó de capturarse. Con la vigencia automática y sin
 * ninguna salida, un "dame una semana más" solo se podía resolver cancelando y
 * volviendo a apartar: se perdía la continuidad del registro y, con ella, el
 * rastro del dinero que ya había entrado a esa fecha.
 *
 * NO recibe una fecha. Renovar da el plazo de la casa, el mismo que todos, y por
 * eso no hace falta guardar un motivo ni una columna nueva: qué se hizo lo dice
 * la acción, y quién y cuándo ya lo guarda la bitácora forense con el antes y el
 * después de `vence`.
 *
 * Si el apartado ya venció y alguien más tomó la fecha, avisa y no procede sin
 * `confirmar` — el mismo trato que apartar sobre una fecha comprometida. Renovar
 * a ciegas volvería a bloquear una fecha que la casa ya vendió.
 */
export async function renovarApartado(
  db: PrismaClient,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede renovar un apartado.');
  const { confirmar } = renovarApartadoSchema.parse(rawInput ?? {});
  const apartado = await db.apartadoFecha.findUnique({ where: { id: apartadoId } });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.canceladoAt) throw new QuoteError(409, 'El apartado está cancelado.');
  if (apartado.quoteId) {
    throw new QuoteError(409, 'Este apartado ya se convirtió en cotización: no hay plazo que renovar.');
  }

  const hoy = hoyCivilMexico();
  // La disponibilidad se mira SIEMPRE, no solo si venció: aunque siga vivo, su
  // propia fecha puede haberse comprometido de otra forma mientras tanto.
  const fecha = apartado.fechaEvento.toISOString().slice(0, 10);
  const disp = await getAvailability(db, fecha, apartado.spaceIds);
  const choques = disp.spaces.filter((s) => s.level === 'bloqueada');
  if (choques.length > 0 && !confirmar) {
    throw new QuoteError(
      409,
      `${choques.map((s) => s.nombre).join(', ')} ya está comprometido el ${fecha}. ` +
        'Confirma si de todos modos quieres renovar este apartado.',
    );
  }

  // Nunca acorta: un apartado que vino del BI vive hasta su fecha, y "renovarlo"
  // no puede dejarlo con siete días hábiles.
  const nuevo = vigenciaDeApartado(hoy);
  return db.apartadoFecha.update({
    where: { id: apartadoId },
    data: { vence: nuevo.getTime() > apartado.vence.getTime() ? nuevo : apartado.vence },
    include: INCLUDE,
  });
}

/**
 * Cancela un apartado: la fecha se libera. Solo admin — es una decisión sobre
 * inventario de fechas y sobre un depósito que ya entró.
 */
export async function cancelarApartado(
  db: PrismaClient,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin puede cancelar un apartado.');
  const { motivo } = cancelarApartadoSchema.parse(rawInput);
  const apartado = await db.apartadoFecha.findUnique({ where: { id: apartadoId } });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.canceladoAt) throw new QuoteError(409, 'El apartado ya está cancelado');
  if (apartado.quoteId) {
    throw new QuoteError(409, 'Este apartado ya se convirtió en cotización: cancela la cotización.');
  }
  return db.apartadoFecha.update({
    where: { id: apartadoId },
    data: { canceladoAt: new Date(), canceladoById: actor.id, motivoCancelacion: motivo },
    include: INCLUDE,
  });
}

/**
 * El cliente de un apartado de BANQUETERO.
 *
 * Con banquetero, él es el cliente de la hacienda: firma él y se le factura a
 * él. Es la misma regla que el cotizador aplica desde el Plan H, donde los
 * campos del cliente quedan de solo lectura. Pedirlos aquí era pedir un dato
 * que ya se sabía —y peor: quien lo capturaba distinto creaba un cliente
 * paralelo para el mismo banquetero.
 *
 * Se reutiliza su ficha de cliente si ya la tiene, en vez de crear una nueva
 * en cada conversión: tres apartados convertidos son tres eventos del mismo
 * señor, no tres clientes.
 */
async function clienteBanquetero(db: PrismaClient, banqueteroId: string) {
  const banquetero = await db.banquetero.findUniqueOrThrow({
    where: { id: banqueteroId },
    select: { nombre: true, telefono: true, correo: true },
  });
  const fichaExistente = await db.client.findFirst({
    where: { nombre: { equals: banquetero.nombre, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return {
    banqueteroId,
    ...(fichaExistente
      ? { clientId: fichaExistente.id }
      : {
          client: {
            nombre: banquetero.nombre,
            telefono: banquetero.telefono ?? undefined,
            correo: correoValido(banquetero.correo) ? banquetero.correo! : undefined,
          },
        }),
  };
}

/**
 * El cliente de un apartado de CLIENTE DIRECTO: el que apartó, siempre.
 *
 * Quien convierte solo puede completarle el teléfono o el correo (un apartado
 * que vino del BI llega sin ninguno, y el contrato exige uno). El nombre no se
 * toca: cambiarlo aquí sería convertir la fecha a nombre de otra persona.
 */
async function clienteDirecto(
  db: PrismaClient,
  clientId: string,
  capturado: { telefono?: unknown; correo?: unknown } | undefined,
) {
  const cliente = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { nombre: true } });
  const telefono = typeof capturado?.telefono === 'string' ? capturado.telefono.trim() : '';
  const correo = typeof capturado?.correo === 'string' ? capturado.correo.trim() : '';
  const contacto = { ...(telefono ? { telefono } : {}), ...(correo ? { correo } : {}) };
  return {
    clientId,
    ...(Object.keys(contacto).length > 0 ? { client: { nombre: cliente.nombre, ...contacto } } : {}),
  };
}

/**
 * Convierte un apartado en cotización.
 *
 * El cuerpo es el de crear una cotización normal (tipo de evento, invitados,
 * cliente, paquete…): eso es justamente lo que el apartado no tenía. Lo que NO se
 * acepta del cuerpo es la fecha, los espacios ni el banquetero — esos vienen del
 * apartado, que es lo que se pagó.
 *
 * Hereda su catálogo si lo tiene (el precio garantizado) y el activo si no. Y el
 * depósito pasa como pago de la cotización nueva **con la fecha en que se
 * recibió**, no con la de la conversión: el candado del Plan C corre por pago y el
 * SAT exige facturar el ingreso en el mes en que entró.
 */
export async function convertirApartado(
  db: PrismaClient,
  storage: ComprobanteStorage,
  apartadoId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const apartado = await db.apartadoFecha.findUnique({
    where: { id: apartadoId },
    include: { abonos: { orderBy: { fecha: 'asc' } } },
  });
  if (!apartado) throw new QuoteError(404, 'Apartado no encontrado');
  if (apartado.quoteId) throw new QuoteError(409, 'Este apartado ya se convirtió en cotización.');
  if (apartado.canceladoAt) throw new QuoteError(409, 'El apartado está cancelado.');

  // Se quitan del cuerpo: lo que el servidor impone no puede llegar de afuera, o
  // un cliente tecleado le ganaría al titular del apartado sin que nadie lo note.
  const resto: Record<string, unknown> = { ...((rawInput ?? {}) as Record<string, unknown>) };
  const contactoCapturado = resto.client as { telefono?: unknown; correo?: unknown } | undefined;
  delete resto.client;
  delete resto.clientId;

  const paraQuien = apartado.banqueteroId
    ? await clienteBanquetero(db, apartado.banqueteroId)
    : await clienteDirecto(db, apartado.clientId!, contactoCapturado);

  /**
   * El catálogo: manda el GARANTIZADO del apartado; si no tiene, el que elija
   * quien convierte; y si tampoco, el activo.
   *
   * El garantizado gana siempre porque es una promesa hecha al banquetero —"te
   * congelo 2027 más ocho por ciento"— y dejar que se sobreescriba desde el
   * cuerpo sería perderla en silencio. Pero cuando NO hay promesa, quien
   * convierte tiene que poder elegir por el año del evento, igual que en el
   * cotizador: un apartado de 2029 convertido en 2026 no debe cotizarse con los
   * precios de 2026.
   */
  const elegido = typeof resto.priceListId === 'string' ? resto.priceListId : undefined;
  delete resto.priceListId;
  const quote = await createQuote(
    db,
    {
      ...resto,
      fecha: apartado.fechaEvento.toISOString().slice(0, 10),
      spaceIds: apartado.spaceIds,
      // El tipo de evento que ya se sabía al apartar, si quien convierte no eligió otro.
      ...(resto.eventTypeId == null && apartado.eventTypeId ? { eventTypeId: apartado.eventTypeId } : {}),
      ...(resto.usaCapilla == null && apartado.usaCapilla ? { usaCapilla: true } : {}),
      ...paraQuien,
    },
    actor,
    {
      priceListId: apartado.priceListId ?? elegido,
      // Su propio apartado no puede bloquearle la fecha.
      excludeApartadoId: apartado.id,
    },
  );

  await db.apartadoFecha.update({ where: { id: apartadoId }, data: { quoteId: quote.id } });
  /*
   * La renta que se pactó al apartar MANDA ("es solo la renta": el BI y el
   * dueño, 5-oct-2026). El contrato se armó con el catálogo; aquí se le pone la
   * renta acordada y queda con precio pactado, como un evento importado: editarlo
   * o moverlo no la recotiza. Va ANTES de los pagos para que el plan de pagos y
   * los conceptos se calculen contra la renta verdadera.
   */
  if (apartado.precioAcordado != null) {
    const lista = await db.priceList.findUniqueOrThrow({ where: { id: quote.priceListId }, select: { ivaRate: true } });
    const desglose = conRentaAcordada(quote.breakdown as unknown as QuoteBreakdown, apartado.precioAcordado, lista.ivaRate);
    await db.quote.update({
      where: { id: quote.id },
      data: {
        breakdown: desglose as unknown as Prisma.InputJsonValue,
        // Columnas enteras: las horas extra pueden traer centavos.
        total: Math.round(desglose.total),
        rentaTotal: Math.round(desglose.rentaTotal),
        precioPactado: true,
      },
    });
    await logActivity(db, {
      quoteId: quote.id,
      tipo: 'creada',
      descripcion: `Renta acordada en el apartado: $${apartado.precioAcordado.toLocaleString('es-MX')} (precio pactado: no se recotiza)`,
      meta: { apartadoId: apartado.id, precioAcordado: apartado.precioAcordado, rentaCatalogo: quote.rentaTotal },
      actorId: actor.id,
    });
  }

  /**
   * Cada abono vivo se vuelve un pago de la cotización, **con su propia fecha de
   * recepción**.
   *
   * Uno por uno y no sumados: tres abonos de 2027, 2028 y 2029 son tres ingresos
   * de tres meses distintos, y el SAT exige facturar cada uno en el suyo. Un solo
   * pago por la suma, con una sola fecha, facturaría dos de ellos fuera de mes —
   * el mismo error que este proyecto ya corrigió dos veces.
   *
   * El abono queda apuntando a su pago: a partir de ahí el que cuenta contra el
   * saldo del depósito es el pago, no el abono, o el dinero se restaría dos veces.
   */
  const pagos = [];
  for (const abono of apartado.abonos.filter((a) => a.anuladoAt == null)) {
    const res = await registerPayment(
      db,
      storage,
      quote.id,
      {
        monto: abono.monto,
        concepto: 'aCuenta',
        fecha: abono.fecha.toISOString().slice(0, 10),
        referencia: abono.referencia ?? `Apartado ${apartado.id}`,
        notas: abono.notas ?? undefined,
      },
      actor,
      undefined,
      {
        // Si el abono salió de un depósito, el pago hereda esa liga: el rastro
        // del dinero no se corta al convertir.
        ...(abono.pagoBanqueteroId ? { pagoBanqueteroId: abono.pagoBanqueteroId } : {}),
        // El abono ya fue la entrada de dinero: el pago hereda su folio y su forma
        // de pago en vez de gastar un folio nuevo.
        folio: abono.folio,
        folioLetra: abono.folioLetra,
        metodo: abono.metodo,
        formas: (abono.formas as PartePago[] | null) ?? null,
        // Y su comprobante viaja con él, en vez de quedarse huérfano en el abono.
        comprobanteKey: abono.comprobanteKey,
        comprobanteMime: abono.comprobanteMime,
        // El idBI del pago viaja con él: es como el BI sabe que ya lo tiene.
        importadoBI: abono.importadoBI,
      },
    );
    await db.abonoApartado.update({
      where: { id: abono.id },
      data: { paymentId: res.payment.id },
    });
    pagos.push({
      id: res.payment.id,
      folio: res.payment.folio,
      monto: res.payment.monto,
      fecha: res.payment.fecha,
    });
  }
  // Se conserva `pago` en singular por compatibilidad de la respuesta: es el
  // primero, y `pagos` trae todos.
  const pago = pagos[0] ?? null;

  const actualizado = await db.apartadoFecha.findUniqueOrThrow({
    where: { id: apartadoId },
    include: INCLUDE,
  });
  // El evento como quedó (con la renta acordada y el estatus que subieron los pagos).
  const final = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
  return { apartado: actualizado, quote: final, pago };
}
