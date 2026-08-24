import { z } from 'zod';
import { NOMBRE_APP, type PrismaClient, type Prisma } from '@hsa/database';

/** Cuántos renglones devuelve una página. */
const POR_PAGINA = 50;
/** Ventana de la alerta "alguien metió mano" del encabezado. */
export const DIAS_ALERTA_EXTERNOS = 30;

/**
 * De dónde salió el cambio. Son tres cosas distintas y confundirlas vuelve
 * inútil la alarma:
 *
 * - `persona`: alguien con sesión, desde la aplicación. Trae nombre.
 * - `sistema`: nuestro propio código sin persona detrás — migraciones,
 *   backfills, el reconciliador del arranque. Sin actor, pero conocido.
 * - `externo`: **cualquier otro cliente de base de datos**. Una consola de SQL,
 *   el panel del proveedor, un script de alguien. Ésta es la que importa.
 *
 * La primera versión de esto marcaba como sospechoso todo lo que no traía actor,
 * y con eso cada backfill de un despliegue disparaba la alarma con cientos de
 * renglones. Una alarma que suena siempre no es una alarma.
 */
export const ORIGENES = ['persona', 'sistema', 'externo'] as const;
export type Origen = (typeof ORIGENES)[number];

export const consultaSchema = z.object({
  tabla: z.string().optional(),
  registroId: z.string().optional(),
  origen: z.enum(ORIGENES).optional(),
  operacion: z.enum(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']).optional(),
  /** Id del último renglón de la página anterior (paginación por cursor). */
  antesDe: z.coerce.bigint().optional(),
});

/** Un cambio que no salió de nuestro código, sin importar si trae actor. */
const ES_EXTERNO: Prisma.AuditoriaDbWhereInput = {
  OR: [{ aplicacion: null }, { aplicacion: { not: NOMBRE_APP } }],
};

const FILTRO_ORIGEN: Record<Origen, Prisma.AuditoriaDbWhereInput> = {
  persona: { actorId: { not: null } },
  sistema: { actorId: null, aplicacion: NOMBRE_APP },
  externo: ES_EXTERNO,
};

export function origenDe(fila: { actorId: string | null; aplicacion: string | null }): Origen {
  if (fila.aplicacion !== NOMBRE_APP) return 'externo';
  return fila.actorId ? 'persona' : 'sistema';
}

export type Consulta = z.infer<typeof consultaSchema>;

export interface RenglonAuditoria {
  id: string;
  tabla: string;
  operacion: string;
  registroId: string | null;
  actorId: string | null;
  /** De dónde salió el cambio. `externo` es la señal que importa. */
  origen: Origen;
  actorNombre: string | null;
  usuarioDb: string;
  aplicacion: string | null;
  direccionIp: string | null;
  createdAt: string;
  /** Qué campos cambiaron (solo en UPDATE), para leer la lista sin abrir cada uno. */
  campos: string[];
}

/**
 * Qué campos cambiaron entre dos versiones de la fila.
 *
 * Se calcula aquí y no en SQL porque la lista necesita el resumen, no el
 * contenido: mandar dos filas completas por renglón para pintar "cambió
 * rentaTotal" son cientos de kilobytes por página.
 */
function camposCambiados(antes: unknown, despues: unknown): string[] {
  if (!antes || !despues || typeof antes !== 'object' || typeof despues !== 'object') return [];
  const a = antes as Record<string, unknown>;
  const d = despues as Record<string, unknown>;
  const llaves = new Set([...Object.keys(a), ...Object.keys(d)]);
  return [...llaves]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .sort();
}

/** Nombres de los actores, para no pintar cuids en pantalla. */
async function nombresDeActores(
  db: PrismaClient,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unicos.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nombre: true },
  });
  return new Map(users.map((u) => [u.id, u.nombre]));
}

export async function listarAuditoria(
  db: PrismaClient,
  q: Consulta,
): Promise<{
  filas: RenglonAuditoria[];
  siguienteCursor: string | null;
  externosRecientes: number;
  tablas: string[];
}> {
  const where: Prisma.AuditoriaDbWhereInput = {
    ...(q.tabla ? { tabla: q.tabla } : {}),
    ...(q.registroId ? { registroId: q.registroId } : {}),
    ...(q.operacion ? { operacion: q.operacion } : {}),
    ...(q.origen ? FILTRO_ORIGEN[q.origen] : {}),
    ...(q.antesDe != null ? { id: { lt: q.antesDe } } : {}),
  };

  const desde = new Date(Date.now() - DIAS_ALERTA_EXTERNOS * 86_400_000);
  const [crudas, externosRecientes, agrupadas] = await Promise.all([
    db.auditoriaDb.findMany({
      where,
      orderBy: { id: 'desc' },
      take: POR_PAGINA + 1,
    }),
    db.auditoriaDb.count({ where: { ...ES_EXTERNO, createdAt: { gte: desde } } }),
    // Las tablas que REALMENTE tienen movimientos, para llenar el desplegable
    // sin inventar opciones que no devuelven nada.
    db.auditoriaDb.groupBy({ by: ['tabla'], orderBy: { tabla: 'asc' } }),
  ]);

  const hayMas = crudas.length > POR_PAGINA;
  const pagina = hayMas ? crudas.slice(0, POR_PAGINA) : crudas;
  const nombres = await nombresDeActores(db, pagina.map((f) => f.actorId));

  return {
    filas: pagina.map((f) => ({
      // `id` es bigint y el serializador de JSON no lo sabe mandar: viaja como texto.
      id: String(f.id),
      tabla: f.tabla,
      operacion: f.operacion,
      registroId: f.registroId,
      actorId: f.actorId,
      actorNombre: f.actorId ? (nombres.get(f.actorId) ?? 'Usuario borrado') : null,
      origen: origenDe(f),
      usuarioDb: f.usuarioDb,
      aplicacion: f.aplicacion,
      direccionIp: f.direccionIp,
      createdAt: f.createdAt.toISOString(),
      campos: f.operacion === 'UPDATE' ? camposCambiados(f.antes, f.despues) : [],
    })),
    siguienteCursor: hayMas ? String(pagina[pagina.length - 1]?.id) : null,
    externosRecientes,
    tablas: agrupadas.map((g) => g.tabla),
  };
}

export interface DetalleAuditoria extends RenglonAuditoria {
  txid: string;
  antes: unknown;
  despues: unknown;
}

export async function detalleAuditoria(
  db: PrismaClient,
  id: bigint,
): Promise<DetalleAuditoria | null> {
  const f = await db.auditoriaDb.findUnique({ where: { id } });
  if (!f) return null;
  const nombres = await nombresDeActores(db, [f.actorId]);
  return {
    id: String(f.id),
    tabla: f.tabla,
    operacion: f.operacion,
    registroId: f.registroId,
    actorId: f.actorId,
    actorNombre: f.actorId ? (nombres.get(f.actorId) ?? 'Usuario borrado') : null,
    origen: origenDe(f),
    usuarioDb: f.usuarioDb,
    aplicacion: f.aplicacion,
    direccionIp: f.direccionIp,
    createdAt: f.createdAt.toISOString(),
    campos: f.operacion === 'UPDATE' ? camposCambiados(f.antes, f.despues) : [],
    txid: f.txid,
    antes: f.antes,
    despues: f.despues,
  };
}
