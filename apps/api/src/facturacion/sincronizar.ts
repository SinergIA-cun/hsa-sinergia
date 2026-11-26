import type { Prisma, PrismaClient } from '@hsa/database';
import { Facturador, facturadorDesdeEnv } from './facturador.js';

/*
 * Facturas del PAC → base de la hacienda (26-nov-2026).
 *
 * Facturador.com no avisa cuando se timbra o se cancela una factura (no tiene
 * webhooks), así que se le pregunta: tres veces al día, a las 8:00, 13:00 y
 * 19:00 de Cancún (pedido de Fernando). Cada vuelta lee el listado del mes
 * anterior y el actual —para alcanzar las cancelaciones tardías— y deja todo en
 * `FacturaPac`, incluidas las facturas hechas directo en el portal del PAC.
 * Solo LEE del PAC; nunca timbra ni cancela.
 */

/** Cancún no cambia de horario: UTC-5 todo el año. */
const OFFSET_CANCUN_H = 5;
/** Las revisiones del día, en hora de Cancún. */
export const HORAS_REVISION = [8, 13, 19] as const;

/** La fecha civil de Cancún de un instante: año, mes (0–11) y día. */
function civilCancun(t: Date): { y: number; m: number; d: number } {
  const c = new Date(t.getTime() - OFFSET_CANCUN_H * 3600_000);
  return { y: c.getUTCFullYear(), m: c.getUTCMonth(), d: c.getUTCDate() };
}

/** La siguiente revisión programada, estrictamente después de `ahora`. */
export function proximaRevision(ahora: Date): Date {
  const { y, m, d } = civilCancun(ahora);
  for (let dia = 0; dia <= 1; dia++) {
    for (const h of HORAS_REVISION) {
      const t = new Date(Date.UTC(y, m, d + dia, h + OFFSET_CANCUN_H));
      if (t.getTime() > ahora.getTime()) return t;
    }
  }
  // Inalcanzable: la de las 8:00 de mañana siempre es futura.
  return new Date(Date.UTC(y, m, d + 1, HORAS_REVISION[0] + OFFSET_CANCUN_H));
}

/** Qué se lee en cada vuelta: desde el día 1 del mes anterior (Cancún) hasta ahora. */
export function ventanaDeRevision(ahora: Date): { desde: Date; hasta: Date } {
  const { y, m } = civilCancun(ahora);
  return { desde: new Date(Date.UTC(y, m - 1, 1, OFFSET_CANCUN_H)), hasta: ahora };
}

/** "Cancelado…" en el estatus o el subestatus; "Espera Cancelación" todavía no lo está. */
export function esCancelada(estatus: string | null | undefined, subestatus: string | null | undefined): boolean {
  return [estatus, subestatus].some((t) => !!t && /cancelad/i.test(t) && !/espera/i.test(t));
}

const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** El primer campo que exista entre varios nombres posibles. */
const campo = (r: Record<string, unknown>, ...nombres: string[]): unknown => {
  for (const n of nombres) if (r[n] != null && r[n] !== '') return r[n];
  return undefined;
};

/** Una fecha del PAC; sin zona se toma como hora de Cancún. */
function fechaDePac(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v);
  const conZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || typeof v === 'number' ? s : `${s}-05:00`;
  const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(conZona);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type FilaFacturaPac = Omit<Prisma.FacturaPacCreateInput, 'createdAt' | 'actualizadoAt' | 'origen'> & {
  fecha: Date;
  crudo: Prisma.InputJsonObject;
};

/**
 * Un renglón del listado del PAC → `FacturaPac`. Los nombres vienen de la doc
 * (`resumenComprobante`); se aceptan variantes por si cambian de mayúsculas.
 * Sin UUID (un comprobante sin timbrar) no hay factura: `null`.
 */
export function filaDePac(r: Record<string, unknown>, ahora = new Date()): FilaFacturaPac | null {
  const uuid = texto(campo(r, 'uuid', 'UUID', 'Uuid'));
  if (!uuid) return null;
  const estatus = texto(campo(r, 'estatus', 'Estatus'));
  const subestatus = texto(campo(r, 'subestatus', 'subEstatus', 'Subestatus'));
  return {
    uuid: uuid.toUpperCase(),
    idComprobante: numero(campo(r, 'idComprobante', 'IdComprobante')),
    fecha: fechaDePac(campo(r, 'fecha', 'fechaEmision', 'fechaTimbrado')) ?? ahora,
    serie: texto(campo(r, 'serie', 'Serie')),
    folio: texto(campo(r, 'folio', 'Folio')),
    tipoComprobante: texto(campo(r, 'tipoComprobante', 'TipoComprobante')),
    estatus,
    subestatus,
    cancelada: esCancelada(estatus, subestatus),
    subtotal: numero(campo(r, 'subtotal', 'subTotal', 'SubTotal')),
    impuestos: numero(campo(r, 'impuestos', 'Impuestos')),
    total: numero(campo(r, 'total', 'Total')) ?? 0,
    moneda: texto(campo(r, 'moneda', 'Moneda')),
    receptorRfc: texto(campo(r, 'receptorRfc', 'rfcReceptor', 'ReceptorRfc')),
    receptorNombre: texto(campo(r, 'receptorNombre', 'nombreReceptor', 'ReceptorNombre')),
    formaPagoClave: texto(campo(r, 'satFormaPagoClave', 'formaPagoClave', 'formaPago')),
    formaPagoNombre: texto(campo(r, 'satFormaPagoNombre', 'formaPagoNombre')),
    crudo: r as Prisma.InputJsonObject,
  };
}

/** Lee una página del listado del PAC. Es una función para poder probar sin PAC. */
export type LectorPac = (q: { desde: Date; hasta: Date; skip: number; take: number }) => Promise<{
  total: number;
  renglones: Record<string, unknown>[];
}>;

/** El lector real desde las llaves FACTURADOR_*; `null` si no están. */
export function lectorDesdeEnv(env: NodeJS.ProcessEnv = process.env): LectorPac | null {
  const config = facturadorDesdeEnv(env);
  if (!config) return null;
  const f = new Facturador(config);
  let emisorId: number | null = null;
  return async (q) => {
    emisorId ??= (await f.emisor()).emisorId;
    return f.listarComprobantes(emisorId, q);
  };
}

export interface ResultadoSincronizacion {
  ok: boolean;
  nuevas: number;
  actualizadas: number;
  error: string | null;
  inicio: Date;
}

const MAX_PAGINAS = 100;
// Una sola vuelta a la vez: la programada y el botón "Revisar ahora" no se pisan.
let enCurso = false;

/** Una vuelta completa: lee la ventana del PAC y deja `FacturaPac` al día. Nunca truena. */
export async function sincronizarFacturas(
  db: PrismaClient,
  lector: LectorPac,
  o: { motivo: string; ahora?: Date; tamPagina?: number },
): Promise<ResultadoSincronizacion> {
  const ahora = o.ahora ?? new Date();
  if (enCurso) return { ok: false, nuevas: 0, actualizadas: 0, error: 'Ya se está revisando el PAC.', inicio: ahora };
  enCurso = true;
  const { desde, hasta } = ventanaDeRevision(ahora);
  const vuelta = await db.sincronizacionPac.create({ data: { motivo: o.motivo, desde, hasta, inicio: ahora } });
  let nuevas = 0;
  let actualizadas = 0;
  try {
    const take = o.tamPagina ?? 100;
    for (let pagina = 0, skip = 0; pagina < MAX_PAGINAS; pagina++, skip += take) {
      const { total, renglones } = await lector({ desde, hasta, skip, take });
      const filas = renglones.map((r) => filaDePac(r, ahora)).filter((f): f is FilaFacturaPac => f != null);
      const conocidas = new Set(
        (await db.facturaPac.findMany({ where: { uuid: { in: filas.map((f) => f.uuid) } }, select: { uuid: true } })).map((x) => x.uuid),
      );
      for (const f of filas) {
        if (conocidas.has(f.uuid)) {
          // `origen` no se toca: una timbrada por la app sigue siendo de la app.
          await db.facturaPac.update({ where: { uuid: f.uuid }, data: f });
          actualizadas++;
        } else {
          await db.facturaPac.create({ data: { ...f, origen: 'pac' } });
          nuevas++;
        }
      }
      if (renglones.length < take || skip + take >= total) break;
    }
    await db.sincronizacionPac.update({ where: { id: vuelta.id }, data: { fin: new Date(), ok: true, nuevas, actualizadas } });
    return { ok: true, nuevas, actualizadas, error: null, inicio: ahora };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.sincronizacionPac.update({ where: { id: vuelta.id }, data: { fin: new Date(), ok: false, nuevas, actualizadas, error: error.slice(0, 500) } });
    return { ok: false, nuevas, actualizadas, error, inicio: ahora };
  } finally {
    enCurso = false;
  }
}

/**
 * La factura que la app acaba de timbrar, al momento: así el BI y el panel la
 * ven sin esperar la siguiente revisión. La revisión después la completa con lo
 * que diga el PAC.
 */
export async function registrarFacturaDeLaApp(
  db: PrismaClient,
  f: { uuid: string; fecha: Date; total: number; serie: string; receptorRfc: string; receptorNombre: string },
): Promise<void> {
  const uuid = f.uuid.toUpperCase();
  const datos = { fecha: f.fecha, total: f.total, serie: f.serie, receptorRfc: f.receptorRfc, receptorNombre: f.receptorNombre, tipoComprobante: 'Factura' };
  await db.facturaPac.upsert({ where: { uuid }, create: { uuid, ...datos, origen: 'app' }, update: { origen: 'app' } });
}

/** Programa las tres revisiones diarias. Devuelve con qué cancelar el siguiente disparo. */
export function iniciarSincronizacionPac(db: PrismaClient, lector: LectorPac | null): { detener: () => void } {
  if (!lector) {
    console.log('Facturas del PAC: sin llaves de Facturador, no se revisan.');
    return { detener: () => {} };
  }
  let timer: NodeJS.Timeout | null = null;
  const programar = () => {
    const siguiente = proximaRevision(new Date());
    timer = setTimeout(async () => {
      const r = await sincronizarFacturas(db, lector, { motivo: 'programada' });
      console.log(
        r.ok
          ? `Facturas del PAC: ${r.nuevas} nuevas, ${r.actualizadas} revisadas.`
          : `Facturas del PAC: FALLÓ la revisión: ${r.error}`,
      );
      programar();
    }, siguiente.getTime() - Date.now());
  };
  programar();
  console.log(`Facturas del PAC: revisión a las ${HORAS_REVISION.join(', ')} h de Cancún; la siguiente ${proximaRevision(new Date()).toISOString()}.`);
  return { detener: () => timer && clearTimeout(timer) };
}
