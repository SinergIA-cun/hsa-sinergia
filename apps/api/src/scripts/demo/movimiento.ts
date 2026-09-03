import { hoyCivilMexico } from '@hsa/shared';
import type { PrismaClient } from '@hsa/database';
import { createQuote, updateOperativa, updateStatus, type Actor } from '../../quotes/service.js';
import { registerPayment } from '../../payments/service.js';
import { registrarDeposito, asignarDeposito } from '../../banqueteros/cuenta.js';
import { crearApartado } from '../../banqueteros/apartados.js';
import { registrarAbono } from '../../banqueteros/abonos.js';
import type { ComprobanteStorage } from '../../payments/storage.js';
import type { CatalogoDemo } from './catalogo.js';

/**
 * El movimiento del DEMO: eventos, pagos, depósitos y apartados.
 *
 * Dos reglas que lo hacen servir para vender:
 *
 * 1. **Todo cuelga de HOY.** Las fechas se calculan contra el reloj, no son
 *    constantes: un demo con fechas fijas se ve vencido a los seis meses, con la
 *    agenda vacía y el tablero en ceros justo enfrente del prospecto.
 * 2. **Los datos los crean los servicios de verdad**, no INSERTs a mano. Así el
 *    desglose lo calcula el motor de precios, los códigos de evento los genera
 *    el generador, los conceptos de pago los deduce el plan y los saldos cuadran.
 *    Un demo con filas forjadas se rompe en la primera pantalla que calcule algo.
 */

/** Los pagos del demo no llevan foto: nadie va a abrir un comprobante en la demo. */
const SIN_ARCHIVOS: ComprobanteStorage = {
  save: async () => ({ key: 'demo', mime: 'image/jpeg' }),
  load: async () => null,
};

const DIA_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * El sábado número `n` contado desde hoy (negativo = hacia atrás). Los salones
 * de eventos viven de fines de semana: una agenda de bodas en martes se ve
 * inventada, porque lo está.
 */
function sabado(hoy: Date, n: number): Date {
  const base = new Date(hoy.getTime());
  // 6 = sábado. Al sábado más próximo, y de ahí de semana en semana.
  base.setUTCDate(base.getUTCDate() + ((6 - base.getUTCDay() + 7) % 7) + n * 7);
  return base;
}

interface Evento {
  /** Semanas desde hoy: negativo = ya pasó. */
  semanas: number;
  tipo: string;
  espacios: string[];
  invitados: number;
  cliente: string;
  telefono: string;
  /** Cuánto se ha pagado: 'nada' deja el borrador, 'todo' liquida. */
  pagado: 'nada' | 'anticipo' | 'mitad' | 'todo';
  banquetero?: string;
  festejado?: string;
  cortesia?: boolean;
  descuentoPct?: number;
  /** Llenarle la hoja operativa, para que su ficha del tablero salga completa. */
  hoja?: boolean;
}

/**
 * La cartera del demo. Repartida a propósito para que TODAS las pantallas
 * tengan algo que enseñar: histórico, agenda del mes, tablero, cuentas de
 * banquetero, borradores por cerrar y fechas apartadas a años vista.
 */
const EVENTOS: Evento[] = [
  // Ya pasaron: alimentan el histórico y los reportes del año.
  { semanas: -46, tipo: 'Boda', espacios: ['Terraza Mirador'], invitados: 320, cliente: 'Familia Escalante', telefono: '5544112200', pagado: 'todo' },
  { semanas: -34, tipo: 'XV Años', espacios: ['Salón Jacarandas'], invitados: 180, cliente: 'Lorena Vidal', telefono: '5544112201', pagado: 'todo', festejado: 'Camila Vidal' },
  { semanas: -27, tipo: 'Graduación', espacios: ['Terraza Mirador'], invitados: 400, cliente: 'Grupo Anfitrión', telefono: '9981234501', pagado: 'todo', banquetero: 'Grupo Anfitrión', festejado: 'Generación 2026 · Prepa Altamira' },
  { semanas: -19, tipo: 'Boda', espacios: ['Jardín Las Palmas'], invitados: 240, cliente: 'Andrés y Paula', telefono: '5544112202', pagado: 'todo' },
  { semanas: -12, tipo: 'Bautizo', espacios: ['Salón Jacarandas'], invitados: 90, cliente: 'Familia Rentería', telefono: '5544112203', pagado: 'todo' },
  { semanas: -6, tipo: 'Corporativo', espacios: ['Salón Jacarandas'], invitados: 120, cliente: 'Seguros Norandina', telefono: '5544112204', pagado: 'todo' },

  // Los próximos meses: comprometidos, con dinero encima.
  // Este fin de semana y el siguiente: son los que llenan las fichas
  // operativas del tablero, la pantalla con la que arranca la demo.
  { semanas: 0, tipo: 'Boda', espacios: ['Terraza Mirador'], invitados: 300, cliente: 'Carla y Emiliano', telefono: '5544112230', pagado: 'todo', hoja: true },
  { semanas: 0, tipo: 'Bautizo', espacios: ['Salón Jacarandas'], invitados: 70, cliente: 'Familia Zavaleta', telefono: '5544112231', pagado: 'todo' },
  { semanas: 1, tipo: 'XV Años', espacios: ['Jardín Las Palmas'], invitados: 210, cliente: 'Norma Cifuentes', telefono: '5544112232', pagado: 'mitad', festejado: 'Aitana Cifuentes' },
  { semanas: 1, tipo: 'Corporativo', espacios: ['Salón Jacarandas'], invitados: 130, cliente: 'Grupo Ferretero Andrade', telefono: '5544112233', pagado: 'anticipo' },
  { semanas: 2, tipo: 'Boda', espacios: ['Terraza Mirador'], invitados: 350, cliente: 'Mariana y Sergio', telefono: '5544112205', pagado: 'todo' },
  { semanas: 4, tipo: 'XV Años', espacios: ['Jardín Las Palmas'], invitados: 220, cliente: 'Héctor Solís', telefono: '5544112206', pagado: 'mitad', festejado: 'Ximena Solís' },
  { semanas: 4, tipo: 'Bautizo', espacios: ['Salón Jacarandas'], invitados: 80, cliente: 'Familia Ballesteros', telefono: '5544112207', pagado: 'anticipo' },
  { semanas: 7, tipo: 'Boda', espacios: ['Jardín Las Palmas'], invitados: 260, cliente: 'Regina y Emilio', telefono: '5544112208', pagado: 'mitad' },
  { semanas: 9, tipo: 'Graduación', espacios: ['Terraza Mirador'], invitados: 480, cliente: 'Banquetes La Higuera', telefono: '9981234500', pagado: 'mitad', banquetero: 'Banquetes La Higuera', festejado: 'Generación 2027 · Colegio Miravalle' },
  { semanas: 11, tipo: 'Corporativo', espacios: ['Salón Jacarandas'], invitados: 150, cliente: 'Textiles del Bajío', telefono: '5544112209', pagado: 'anticipo' },
  { semanas: 15, tipo: 'Boda', espacios: ['Jardín Las Palmas'], invitados: 280, cliente: 'Banquetes La Higuera', telefono: '9981234500', pagado: 'anticipo', banquetero: 'Banquetes La Higuera', festejado: 'Itzel y Marco' },
  // Dos salones: el cupo se suma y la gente se reparte entre los dos.
  { semanas: 13, tipo: 'Boda', espacios: ['Salón Jacarandas', 'Jardín Las Palmas'], invitados: 520, cliente: 'Fernanda y Rodrigo', telefono: '5544112210', pagado: 'mitad' },
  { semanas: 16, tipo: 'XV Años', espacios: ['Terraza Mirador'], invitados: 300, cliente: 'Mesa Larga Catering', telefono: '9981234502', pagado: 'anticipo', banquetero: 'Mesa Larga Catering', festejado: 'Renata Aguilar' },
  { semanas: 19, tipo: 'Boda', espacios: ['Jardín Las Palmas'], invitados: 200, cliente: 'Sofía y Damián', telefono: '5544112211', pagado: 'anticipo' },
  { semanas: 23, tipo: 'Boda', espacios: ['Terraza Mirador'], invitados: 380, cliente: 'Valeria y Nicolás', telefono: '5544112212', pagado: 'anticipo' },
  { semanas: 28, tipo: 'Graduación', espacios: ['Terraza Mirador'], invitados: 520, cliente: 'Sabores del Valle', telefono: '9981234503', pagado: 'anticipo', banquetero: 'Sabores del Valle' },

  // Cortesía familiar y un descuento autorizado: los dos casos que se marcan aparte.
  { semanas: 6, tipo: 'Bautizo', espacios: ['Salón Jacarandas'], invitados: 60, cliente: 'Familia del propietario', telefono: '5544112213', pagado: 'nada', cortesia: true },
  { semanas: 21, tipo: 'Boda', espacios: ['Jardín Las Palmas'], invitados: 230, cliente: 'Ana y Julián', telefono: '5544112214', pagado: 'anticipo', descuentoPct: 8 },

  // Borradores: lo que el equipo trae entre manos.
  { semanas: 3, tipo: 'Boda', espacios: ['Salón Jacarandas'], invitados: 150, cliente: 'Cecilia Moctezuma', telefono: '5544112215', pagado: 'nada' },
  { semanas: 8, tipo: 'XV Años', espacios: ['Salón Jacarandas'], invitados: 190, cliente: 'Raúl Betancourt', telefono: '5544112216', pagado: 'nada', festejado: 'Ivanna Betancourt' },
  { semanas: 12, tipo: 'Corporativo', espacios: ['Jardín Las Palmas'], invitados: 110, cliente: 'Constructora Peñaloza', telefono: '5544112217', pagado: 'nada' },
  { semanas: 17, tipo: 'Boda', espacios: ['Terraza Mirador'], invitados: 420, cliente: 'Ximena y Bruno', telefono: '5544112218', pagado: 'nada' },
  { semanas: 26, tipo: 'Boda', espacios: ['Salón Jacarandas'], invitados: 170, cliente: 'Daniela y Óscar', telefono: '5544112219', pagado: 'nada' },
  { semanas: 34, tipo: 'Graduación', espacios: ['Terraza Mirador'], invitados: 460, cliente: 'Casa Olivo Eventos', telefono: '9981234504', pagado: 'nada', banquetero: 'Casa Olivo Eventos' },
];

export interface ResumenMovimiento {
  eventos: number;
  pagos: number;
  depositos: number;
  apartados: number;
}

export async function sembrarMovimientoDemo(
  prisma: PrismaClient,
  cat: CatalogoDemo,
  actor: Actor,
): Promise<ResumenMovimiento> {
  const hoy = hoyCivilMexico();
  const idEspacio = new Map(cat.espacios.map((e) => [e.nombre, e.id]));
  const idTipo = new Map(cat.tiposEvento.map((t) => [t.nombre, t.id]));
  const paqueteDe = new Map(cat.paquetes.map((p) => [p.eventTypeId, p.id]));
  const idBanquetero = new Map(cat.banqueteros.map((b) => [b.nombre, b.id]));
  const reglas = await prisma.spacePaymentRule.findMany();
  const anticipoDe = new Map(reglas.map((r) => [r.spaceId, r.anticipo]));

  let pagos = 0;
  const creadas: { id: string; total: number; fecha: Date }[] = [];

  for (const ev of EVENTOS) {
    const fecha = sabado(hoy, ev.semanas);
    const eventTypeId = idTipo.get(ev.tipo)!;
    const spaceIds = ev.espacios.map((n) => idEspacio.get(n)!);

    const quote = await createQuote(
      prisma,
      {
        fecha: iso(fecha),
        invitados: ev.invitados,
        spaceIds,
        eventTypeId,
        foodPackageId: paqueteDe.get(eventTypeId),
        horasExtra: ev.semanas % 3 === 0 ? 1 : 0,
        esCortesia: ev.cortesia ?? false,
        requiereFactura: ev.tipo === 'Corporativo',
        ...(ev.descuentoPct
          ? { descuentoPct: ev.descuentoPct, descuentoMotivo: 'Descuento autorizado por dirección' }
          : {}),
        ...(ev.banquetero
          ? { banqueteroId: idBanquetero.get(ev.banquetero)!, festejado: ev.festejado }
          : { festejado: ev.festejado }),
        client: { nombre: ev.cliente, telefono: ev.telefono },
      },
      actor,
    );
    creadas.push({ id: quote.id, total: quote.total, fecha });

    if (ev.pagado === 'nada') continue;

    // El anticipo entra cuando se cerró el trato, no el día del evento: seis
    // semanas antes, o hoy si el evento está más cerca que eso.
    const anticipoFecha = new Date(Math.min(fecha.getTime() - 42 * DIA_MS, hoy.getTime()));
    const anticipo = anticipoDe.get(spaceIds[0]!) ?? 5_000;
    await registerPayment(prisma, SIN_ARCHIVOS, quote.id, { monto: anticipo, metodo: 'transferencia', fecha: iso(anticipoFecha), referencia: 'Transferencia SPEI' }, actor);
    pagos += 1;

    if (ev.pagado === 'mitad' || ev.pagado === 'todo') {
      const complemento = Math.round((quote.total - anticipo) * (ev.pagado === 'todo' ? 1 : 0.4));
      const compFecha = new Date(Math.min(fecha.getTime() - 21 * DIA_MS, hoy.getTime()));
      await registerPayment(prisma, SIN_ARCHIVOS, quote.id, { monto: complemento, metodo: 'transferencia', fecha: iso(compFecha), referencia: 'Transferencia SPEI' }, actor);
      pagos += 1;
    }

    await updateStatus(prisma, quote.id, ev.pagado === 'todo' ? 'liquidada' : 'formalizada', actor);

    // La hoja operativa de un evento inminente: es lo que convierte la ficha del
    // tablero en algo que se puede enseñar en vez de un cascarón vacío.
    if (ev.hoja) {
      await updateOperativa(
        prisma,
        quote.id,
        {
          horarioCivil: '17:00 en el jardín',
          horaInicio: '18:00',
          horaTermino: '02:00',
          hoja: {
            nombreFestejado: ev.festejado ?? ev.cliente,
            relacionCliente: 'Novios',
            // Texto y no `banqueteroId`: el banquetero de la hoja es quien da
            // de comer, y ligarlo a la cotización lo metería a su cuenta
            // corriente sin que haya dinero suyo de por medio.
            banquetero: 'Banquetes Río Verde',
            banqueteroPaqHsa: false,
            horaMisa: '16:00',
            capilla: true,
            fotografia: true,
            estrado: 'Frente al espejo de agua',
            pista: 'Iluminada, centro del salón',
            personalHsaRows: [
              { nombre: 'Isaac Peralta', hora: '14:00', rol: 'Jefe de área' },
              { nombre: 'Rosa Melgar', hora: '15:00' },
              { nombre: 'Norma Sandoval', hora: '15:00' },
              { nombre: 'Julián Ordaz', hora: '16:00' },
            ],
          },
        },
        actor,
      );
    }
  }

  // ── Cuenta corriente de un banquetero ────────────────────────────────────
  // Un depósito grande que se reparte entre dos de sus eventos y deja saldo sin
  // asignar: es el caso que más cuesta explicar de palabra y el que la pantalla
  // resuelve sola.
  const higuera = idBanquetero.get('Banquetes La Higuera')!;
  const suyos = await prisma.quote.findMany({
    where: { banqueteroId: higuera },
    select: { id: true },
    take: 2,
  });
  const deposito = await registrarDeposito(
    prisma,
    SIN_ARCHIVOS,
    higuera,
    { monto: 300_000, metodo: 'transferencia', fecha: iso(new Date(hoy.getTime() - 30 * DIA_MS)), referencia: 'SPEI 884120' },
    actor,
  );
  if (suyos.length > 0) {
    await asignarDeposito(
      prisma,
      SIN_ARCHIVOS,
      deposito.id,
      // Montos distintos a propósito: un reparto real no es una división exacta.
      { asignaciones: suyos.map((q, i) => ({ quoteId: q.id, monto: i === 0 ? 90_000 : 60_000 })) },
      actor,
    );
    pagos += suyos.length;
  }

  // ── Fechas apartadas ─────────────────────────────────────────────────────
  // El caso del dueño: una fecha a años vista, sin cliente ni PAX ni precio, que
  // se va abonando de poco a poco.
  const { apartado: lejana } = await crearApartado(
    prisma,
    idBanquetero.get('Grupo Anfitrión')!,
    {
      fechaEvento: iso(sabado(hoy, 130)),
      spaceIds: [idEspacio.get('Terraza Mirador')!],
      vence: iso(new Date(hoy.getTime() + 300 * DIA_MS)),
      nota: 'Graduación 2029. Todavía sin escuela definida.',
    },
    actor,
  );
  await registrarAbono(prisma, SIN_ARCHIVOS, lejana.id, { monto: 40_000, metodo: 'transferencia', fecha: iso(new Date(hoy.getTime() - 200 * DIA_MS)), referencia: 'Primer abono' }, actor);
  await registrarAbono(prisma, SIN_ARCHIVOS, lejana.id, { monto: 35_000, metodo: 'efectivo', fecha: iso(new Date(hoy.getTime() - 60 * DIA_MS)) }, actor);

  // Y una que vence pronto, para que el aviso de "por vencer" tenga qué avisar.
  await crearApartado(
    prisma,
    idBanquetero.get('Casa Olivo Eventos')!,
    {
      fechaEvento: iso(sabado(hoy, 60)),
      spaceIds: [idEspacio.get('Jardín Las Palmas')!],
      vence: iso(new Date(hoy.getTime() + 12 * DIA_MS)),
      nota: 'Apartado sin confirmar. Se le habló el lunes.',
    },
    actor,
  );

  return { eventos: creadas.length, pagos, depositos: 1, apartados: 2 };
}
