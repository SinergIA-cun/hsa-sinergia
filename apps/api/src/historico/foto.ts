import { normalizaTexto, type QuoteBreakdown } from '@hsa/shared';
import type { PrismaClient, Prisma } from '@hsa/database';
import { loadEstadoCuenta } from '../quotes/service.js';

/** Un pago tal como quedó, con su folio: la foto no depende de la tabla viva. */
export interface PagoFoto {
  folio: number;
  monto: number;
  metodo: string;
  concepto: string;
  fechaISO: string;
  referencia: string | null;
  registradoPor: string | null;
  facturado: boolean;
  facturaUuid: string | null;
  anulado: boolean;
  motivoAnulacion: string | null;
}

/**
 * Lo que sucedió ese día, resuelto y aplanado.
 *
 * **Nombres, no ids.** Un `spaceId` de hoy es basura en diez años; "Jardín La
 * Cúpula" se lee siempre. La foto tiene que sostenerse sola aunque el catálogo,
 * los espacios y hasta el cliente hayan cambiado o desaparecido.
 */
export interface FotoEvento {
  tomadaEnISO: string;
  /** El folio del evento: la liga estable entre todas sus fotos. */
  folio: string;
  /** Cómo se describía el evento el día en que se tomó ESTA foto. */
  etiqueta: string | null;
  fechaEventoISO: string;
  status: string;
  /** ¿Llegó a apartar la fecha? `false` = quedó en borrador y el evento no se dio. */
  seRealizo: boolean;
  liquidado: boolean;

  cliente: {
    nombre: string;
    telefono: string | null;
    correo: string | null;
    empresa: string | null;
    referencia: number | null;
    /** Como estaban ENTONCES: con esto se timbró (o se pudo timbrar). */
    rfc: string | null;
    razonSocial: string | null;
    regimenFiscal: string | null;
    cpFiscal: string | null;
    usoCfdi: string | null;
    correoFacturacion: string | null;
    requiereFactura: boolean;
  };

  banquetero: string | null;
  festejado: string | null;
  festejadoTelefono: string | null;
  vendedor: string | null;

  evento: {
    tipo: string;
    espacios: string[];
    catalogo: string;
    invitados: number;
    horasEvento: number | null;
    horasExtra: number;
    usaCapilla: boolean;
    capillaHorario: string | null;
    esCortesia: boolean;
    descuentoPct: number | null;
    descuentoMotivo: string | null;
    usaDjHoraExtra: boolean;
    horaInicio: string | null;
    horaTermino: string | null;
    horarioCivil: string | null;
  };

  /** El desglose CONGELADO de la cotización, tal como se cobró. */
  desglose: QuoteBreakdown | null;
  /**
   * `saldoRenta` y no "saldo" a secas: en toda esta aplicación el estado de
   * cuenta se calcula sobre la RENTA (`rentaTotal`), no sobre el total del
   * evento — el plan de pagos, el contrato y las alertas del tablero significan
   * eso. Nombrarlo "saldo" en la foto haría creer que incluye alimentos y
   * servicios, y una foto que se lee sola no se puede permitir esa ambigüedad.
   */
  totales: { total: number; rentaTotal: number; pagado: number; saldoRenta: number };
  pagos: PagoFoto[];
  /** La hoja operativa completa, tal como quedó capturada. */
  operativa: Record<string, unknown> | null;
}

/** El resumen que se guarda en columnas para poder buscar y ordenar sin abrir el json. */
export interface ResumenFoto {
  cliente: string;
  banquetero: string | null;
  eventoTipo: string;
  espacios: string[];
  total: number;
  pagado: number;
  saldo: number;
  seRealizo: boolean;
  liquidado: boolean;
  busqueda: string;
}

const STATUS_QUE_APARTA = new Set(['formalizada', 'complementada', 'liquidada']);

const CON_TODO = {
  client: true,
  eventType: { select: { nombre: true } },
  priceList: { select: { nombre: true } },
  banquetero: { select: { nombre: true } },
  createdBy: { select: { nombre: true } },
} as const;

export type QuoteParaFoto = Prisma.QuoteGetPayload<{ include: typeof CON_TODO }>;

export const INCLUDE_FOTO = CON_TODO;

/**
 * Arma la foto de un evento.
 *
 * `tomadaEnISO` se llena al escribir, no aquí: si viniera de dentro, dos fotos
 * idénticas nunca se verían iguales y cada barrido escribiría una versión nueva
 * de todo. La comparación necesita que lo único que cambie sea el contenido.
 */
export async function armarFoto(
  db: PrismaClient,
  quote: QuoteParaFoto,
  nombresDeEspacios: Map<string, string>,
): Promise<{ foto: Omit<FotoEvento, 'tomadaEnISO'>; resumen: ResumenFoto }> {
  const { estadoCuenta, payments } = await loadEstadoCuenta(db, quote);

  const espacios = quote.spaceIds.map((id) => nombresDeEspacios.get(id) ?? id);
  const banquetero = quote.banquetero?.nombre ?? null;
  const seRealizo = STATUS_QUE_APARTA.has(quote.status);
  const liquidado = quote.status === 'liquidada';

  // Quién registró cada pago, por nombre. Un id de usuario no dice nada dentro
  // de una foto que tiene que leerse sin las tablas vivas.
  const registradores = await db.user.findMany({
    where: { id: { in: [...new Set(payments.map((p) => p.registradoById).filter((v): v is string => Boolean(v)))] } },
    select: { id: true, nombre: true },
  });
  const nombrePorUsuario = new Map(registradores.map((u) => [u.id, u.nombre]));

  const pagos: PagoFoto[] = payments.map((p) => ({
    folio: p.folio,
    monto: p.monto,
    metodo: p.metodo,
    concepto: p.conceptoManual ?? p.concepto,
    fechaISO: p.fecha.toISOString(),
    referencia: p.referencia,
    registradoPor: p.registradoById ? (nombrePorUsuario.get(p.registradoById) ?? null) : null,
    facturado: p.facturadoAt != null,
    facturaUuid: p.facturaUuid,
    anulado: p.anuladoAt != null,
    motivoAnulacion: p.motivoAnulacion,
  }));

  const foto: Omit<FotoEvento, 'tomadaEnISO'> = {
    folio: quote.folio,
    etiqueta: quote.etiqueta,
    fechaEventoISO: quote.fechaEvento.toISOString(),
    status: quote.status,
    seRealizo,
    liquidado,
    cliente: {
      nombre: quote.client.nombre,
      telefono: quote.client.telefono,
      correo: quote.client.correo,
      empresa: quote.client.empresa,
      referencia: quote.client.numeroReferencia,
      rfc: quote.client.rfc,
      razonSocial: quote.client.razonSocial,
      regimenFiscal: quote.client.regimenFiscal,
      cpFiscal: quote.client.cpFiscal,
      usoCfdi: quote.client.usoCfdi,
      correoFacturacion: quote.client.correoFacturacion,
      requiereFactura: quote.requiereFactura,
    },
    banquetero,
    festejado: quote.festejado,
    festejadoTelefono: quote.festejadoTelefono,
    vendedor: quote.createdBy?.nombre ?? null,
    evento: {
      tipo: quote.eventType.nombre,
      espacios,
      catalogo: quote.priceList.nombre,
      invitados: quote.invitados,
      horasEvento: quote.horasEvento,
      horasExtra: quote.horasExtra,
      usaCapilla: quote.usaCapilla,
      capillaHorario: quote.capillaHorario,
      esCortesia: quote.esCortesia,
      descuentoPct: quote.descuentoPct,
      descuentoMotivo: quote.descuentoMotivo,
      usaDjHoraExtra: quote.usaDjHoraExtra,
      horaInicio: quote.horaInicio,
      horaTermino: quote.horaTermino,
      horarioCivil: quote.horarioCivil,
    },
    desglose: (quote.breakdown ?? null) as QuoteBreakdown | null,
    totales: {
      total: quote.total,
      rentaTotal: quote.rentaTotal,
      pagado: estadoCuenta.pagado,
      saldoRenta: estadoCuenta.saldo,
    },
    pagos,
    operativa: (quote.operativa ?? null) as Record<string, unknown> | null,
  };

  const resumen: ResumenFoto = {
    cliente: quote.client.nombre,
    banquetero,
    eventoTipo: quote.eventType.nombre,
    espacios,
    total: quote.total,
    pagado: estadoCuenta.pagado,
    saldo: estadoCuenta.saldo,
    seRealizo,
    liquidado,
    busqueda: normalizaTexto(
      [quote.client.nombre, quote.folio, quote.etiqueta, banquetero, quote.festejado, ...espacios, quote.eventType.nombre]
        .filter(Boolean)
        .join(' '),
    ),
  };

  return { foto, resumen };
}
