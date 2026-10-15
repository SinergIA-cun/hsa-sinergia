import { z } from 'zod';
import type { PrismaClient, Prisma } from '@hsa/database';
import type { Marca } from '@hsa/shared';
import { QuoteError, type Actor } from '../quotes/service.js';
import type { Mailer } from '../correos/mailer.js';
import { correoApartadoPorVencer } from '../correos/plantillas.js';

/**
 * Apartados rápidos con fila de espera (Jorge, 15-oct-2026).
 *
 * Alguien pide una fecha: se captura con lo mínimo (nombre, teléfono, tipo de
 * evento) y se le guarda 15 días. Varios pueden pedir el mismo día y hacen fila,
 * en orden de llegada, hasta el tope que fije el admin (5 a 10). Tres días antes
 * de vencer se avisa al vendedor que lo capturó y a los admins (app y correo)
 * para que confirmen con la persona; al vencer se libera solo y el siguiente de
 * la fila sube. NO bloquea la fecha: solo avisa al cotizarla (decisión de
 * Fernando).
 */

export const DIAS_APARTADO = 15;
export const DIAS_AVISO = 3;
export const TOPE_MIN = 5;
export const TOPE_MAX = 10;
const TOPE_DEFAULT = 10;
const CLAVE_TOPE = 'apartadosRapidos.topePorDia';
const DIA_MS = 24 * 60 * 60 * 1000;

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');

export const crearSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre.').max(120),
  telefono: z
    .string()
    .trim()
    .transform((t) => t.replace(/[^\d+]/g, ''))
    .refine((t) => t.replace(/\D/g, '').length >= 10, 'El teléfono necesita al menos 10 dígitos.'),
  eventTypeId: z.string().min(1, 'Escoge el tipo de evento.'),
  fecha: fechaISO,
  nota: z.string().trim().max(300).optional(),
});

const motivoSchema = z.object({ motivo: z.string().trim().max(300).optional() });
export const topeSchema = z.object({ tope: z.number().int().min(TOPE_MIN).max(TOPE_MAX) });
export const convertirSchema = z.object({ quoteId: z.string().min(1) });

const aFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDe = (d: Date) => d.toISOString().slice(0, 10);
/** Días que le quedan, redondeado hacia arriba: vence mañana a esta hora = 1. */
export const diasRestantes = (vence: Date, ahora: Date) => Math.max(0, Math.ceil((vence.getTime() - ahora.getTime()) / DIA_MS));

export async function topePorDia(db: PrismaClient): Promise<number> {
  const a = await db.ajuste.findUnique({ where: { clave: CLAVE_TOPE } });
  const n = typeof a?.valor === 'number' ? a.valor : TOPE_DEFAULT;
  return Math.min(TOPE_MAX, Math.max(TOPE_MIN, n));
}

export async function fijarTope(db: PrismaClient, raw: unknown, actor: Actor) {
  if (actor.role !== 'admin') throw new QuoteError(403, 'Solo un admin cambia el tope de la fila.');
  const { tope } = topeSchema.parse(raw);
  await db.ajuste.upsert({ where: { clave: CLAVE_TOPE }, create: { clave: CLAVE_TOPE, valor: tope }, update: { valor: tope } });
  return { tope };
}

const incluir = {
  eventType: { select: { id: true, nombre: true } },
  createdBy: { select: { id: true, nombre: true } },
} satisfies Prisma.ApartadoRapidoInclude;

type ConRels = Prisma.ApartadoRapidoGetPayload<{ include: typeof incluir }>;

/** Lo que ve la pantalla: con su lugar en la fila del día y los días que le quedan. */
function vista(a: ConRels, posicion: number, ahora: Date, actor: Actor) {
  const dias = diasRestantes(a.vence, ahora);
  return {
    id: a.id,
    nombre: a.nombre,
    telefono: a.telefono,
    eventType: a.eventType,
    fecha: isoDe(a.fecha),
    vence: a.vence.toISOString(),
    diasRestantes: dias,
    porVencer: dias <= DIAS_AVISO,
    posicion,
    nota: a.nota,
    extensiones: a.extensiones,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    // Confirmar, liberar o convertir: quien lo capturó o un admin.
    puedeGestionar: actor.role === 'admin' || a.createdById === actor.id,
  };
}

/** Los activos de esos días, en orden de fila (el primero que llegó, primero). */
async function activosDe(db: PrismaClient, where: Prisma.ApartadoRapidoWhereInput) {
  return db.apartadoRapido.findMany({
    where: { ...where, estado: 'activo' },
    include: incluir,
    orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** Les pone su lugar en la fila de su día. Recibe la lista ya en orden de fila. */
function conPosicion(lista: ConRels[], ahora: Date, actor: Actor) {
  const porDia = new Map<string, number>();
  return lista.map((a) => {
    const k = isoDe(a.fecha);
    const n = (porDia.get(k) ?? 0) + 1;
    porDia.set(k, n);
    return vista(a, n, ahora, actor);
  });
}

export async function listarApartados(db: PrismaClient, desde: string, hasta: string, actor: Actor, ahora = new Date()) {
  const lt = aFecha(hasta);
  lt.setUTCDate(lt.getUTCDate() + 1);
  const [lista, tope] = await Promise.all([activosDe(db, { fecha: { gte: aFecha(desde), lt } }), topePorDia(db)]);
  return { apartados: conPosicion(lista, ahora, actor), tope };
}

/** Los que vencen en 3 días o menos: los suyos para un vendedor, todos para un admin. */
export async function apartadosPorVencer(db: PrismaClient, actor: Actor, ahora = new Date()) {
  const limite = new Date(ahora.getTime() + DIAS_AVISO * DIA_MS);
  const vencen = await activosDe(db, {
    vence: { lte: limite },
    ...(actor.role === 'admin' ? {} : { createdById: actor.id }),
  });
  if (vencen.length === 0) return { apartados: [] };
  // Su lugar en la fila se cuenta contra TODOS los activos de su día.
  const dias = [...new Set(vencen.map((a) => a.fecha.getTime()))].map((t) => new Date(t));
  const filas = conPosicion(await activosDe(db, { fecha: { in: dias } }), ahora, actor);
  const ids = new Set(vencen.map((a) => a.id));
  return { apartados: filas.filter((a) => ids.has(a.id)).sort((a, b) => a.vence.localeCompare(b.vence)) };
}

/** Cuántos hay en fila ese día: lo usa el aviso de disponibilidad al cotizar. */
export async function filaDelDia(db: PrismaClient, fecha: Date): Promise<{ total: number; primero: string | null }> {
  const lista = await db.apartadoRapido.findMany({
    where: { fecha, estado: 'activo' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { nombre: true },
  });
  return { total: lista.length, primero: lista[0]?.nombre ?? null };
}

export async function crearApartado(db: PrismaClient, raw: unknown, actor: Actor, ahora = new Date()) {
  const input = crearSchema.parse(raw);
  const fecha = aFecha(input.fecha);
  const hoy = aFecha(ahora.toISOString().slice(0, 10));
  if (fecha < hoy) throw new QuoteError(400, 'Esa fecha ya pasó.');
  const tipo = await db.eventType.findUnique({ where: { id: input.eventTypeId }, select: { id: true } });
  if (!tipo) throw new QuoteError(400, 'Ese tipo de evento no existe.');

  const [enFila, tope] = await Promise.all([
    db.apartadoRapido.findMany({ where: { fecha, estado: 'activo' }, select: { telefono: true } }),
    topePorDia(db),
  ]);
  if (enFila.some((a) => a.telefono === input.telefono)) {
    throw new QuoteError(409, 'Esa persona ya está en la fila de ese día.');
  }
  if (enFila.length >= tope) {
    throw new QuoteError(409, `La fila de ese día está llena (${tope} de ${tope}).`);
  }
  const creado = await db.apartadoRapido.create({
    data: {
      nombre: input.nombre,
      telefono: input.telefono,
      eventTypeId: input.eventTypeId,
      fecha,
      vence: new Date(ahora.getTime() + DIAS_APARTADO * DIA_MS),
      nota: input.nota || null,
      createdById: actor.id,
    },
    include: incluir,
  });
  return vista(creado, enFila.length + 1, ahora, actor);
}

async function gestionable(db: PrismaClient, id: string, actor: Actor) {
  const a = await db.apartadoRapido.findUnique({ where: { id } });
  if (!a) throw new QuoteError(404, 'Apartado no encontrado.');
  if (actor.role !== 'admin' && a.createdById !== actor.id) {
    throw new QuoteError(403, 'Solo quien lo capturó o un admin puede cambiarlo.');
  }
  if (a.estado !== 'activo') throw new QuoteError(409, 'Ese apartado ya no está activo.');
  return a;
}

/** Se confirmó con la persona: otros 15 días desde hoy. */
export async function confirmarApartado(db: PrismaClient, id: string, actor: Actor, ahora = new Date()) {
  await gestionable(db, id, actor);
  const a = await db.apartadoRapido.update({
    where: { id },
    data: { vence: new Date(ahora.getTime() + DIAS_APARTADO * DIA_MS), extensiones: { increment: 1 }, avisoEnviadoAt: null },
  });
  return { id: a.id, vence: a.vence.toISOString(), diasRestantes: diasRestantes(a.vence, ahora) };
}

export async function liberarApartado(db: PrismaClient, id: string, raw: unknown, actor: Actor, ahora = new Date()) {
  await gestionable(db, id, actor);
  const { motivo } = motivoSchema.parse(raw ?? {});
  await db.apartadoRapido.update({
    where: { id },
    data: { estado: 'liberado', cerradoAt: ahora, cerradoById: actor.id, motivoCierre: motivo || 'Liberado a mano' },
  });
  return { ok: true };
}

/** Se volvió evento: se cierra y queda ligado a la cotización. */
export async function convertirApartado(db: PrismaClient, id: string, raw: unknown, actor: Actor, ahora = new Date()) {
  await gestionable(db, id, actor);
  const { quoteId } = convertirSchema.parse(raw);
  const q = await db.quote.findUnique({ where: { id: quoteId }, select: { id: true } });
  if (!q) throw new QuoteError(400, 'Ese evento no existe.');
  await db.apartadoRapido.update({
    where: { id },
    data: { estado: 'convertido', quoteId, cerradoAt: ahora, cerradoById: actor.id, motivoCierre: 'Se convirtió en evento' },
  });
  return { ok: true };
}

/**
 * La vuelta periódica: libera los vencidos y manda el aviso de "vence en 3
 * días" (una vez por vencimiento) al vendedor que lo capturó y a los admins.
 * Sin SMTP no manda nada y no marca el aviso como enviado: en la app el aviso
 * sale igual (Inicio y la agenda), porque ese lo calcula la pantalla.
 */
export async function barrerApartados(
  db: PrismaClient,
  mailer: Mailer | null,
  marca: Marca,
  webUrl: string,
  ahora = new Date(),
): Promise<{ liberados: number; avisos: number }> {
  const liberados = await db.apartadoRapido.updateMany({
    where: { estado: 'activo', vence: { lte: ahora } },
    data: { estado: 'liberado', cerradoAt: ahora, motivoCierre: `Venció a los ${DIAS_APARTADO} días sin confirmar` },
  });
  if (!mailer) return { liberados: liberados.count, avisos: 0 };

  const limite = new Date(ahora.getTime() + DIAS_AVISO * DIA_MS);
  const porAvisar = await db.apartadoRapido.findMany({
    where: { estado: 'activo', vence: { lte: limite }, avisoEnviadoAt: null },
    include: { ...incluir, createdBy: { select: { id: true, nombre: true, email: true, activo: true } } },
  });
  if (porAvisar.length === 0) return { liberados: liberados.count, avisos: 0 };
  const admins = await db.user.findMany({ where: { role: 'admin', activo: true }, select: { email: true } });

  let avisos = 0;
  for (const a of porAvisar) {
    const fila = await db.apartadoRapido.findMany({
      where: { fecha: a.fecha, estado: 'activo' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const correo = correoApartadoPorVencer(
      marca,
      {
        nombre: a.nombre,
        telefono: a.telefono,
        tipoEvento: a.eventType.nombre,
        fecha: isoDe(a.fecha),
        vence: a.vence.toISOString().slice(0, 10),
        diasRestantes: diasRestantes(a.vence, ahora),
        posicion: fila.findIndex((f) => f.id === a.id) + 1,
        capturo: a.createdBy.nombre,
      },
      `${webUrl.replace(/\/$/, '')}/agenda/apartados?v=mes&d=${isoDe(a.fecha)}`,
    );
    const para = [...new Set([...(a.createdBy.activo ? [a.createdBy.email] : []), ...admins.map((x) => x.email)])];
    try {
      for (const to of para) await mailer.send({ to, ...correo });
      await db.apartadoRapido.update({ where: { id: a.id }, data: { avisoEnviadoAt: ahora } });
      avisos++;
    } catch (e) {
      console.error(`Apartados: no se pudo mandar el aviso de ${a.id}.`, e);
    }
  }
  return { liberados: liberados.count, avisos };
}

export function iniciarApartados(db: PrismaClient, mailer: Mailer | null, marca: Marca, webUrl: string, cadaMs = 10 * 60_000) {
  const vuelta = async () => {
    try {
      const r = await barrerApartados(db, mailer, marca, webUrl);
      if (r.liberados || r.avisos) console.log(`Apartados: ${r.liberados} liberados por vencer, ${r.avisos} avisos mandados.`);
    } catch (e) {
      console.error('Apartados: falló la vuelta.', e);
    }
  };
  void vuelta();
  return setInterval(() => void vuelta(), cadaMs);
}
