import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@hsa/database';
import { montoNoNegativoSchema, unaComision } from '@hsa/shared';
import { requireAdmin, requireAuth } from '../auth/plugin.js';

/**
 * Proveedores: flores, sonido, DJ, pista de baile, la mesa de dulces… (apartado
 * "Proveedores" desde el 11-nov-2026). Son globales —no por catálogo— y su `id`
 * es la clave fija que ve el BI. No se borran: se desactivan, porque los
 * servicios de catálogos viejos y lo ya vendido los siguen nombrando.
 *
 * Cada uno tiene sus productos con la comisión pactada. Todos los ven (ventas
 * escoge un producto al vender); darlos de alta y cambiar comisiones es de admin,
 * porque la comisión es dinero pactado.
 */
const nombre = z.string().trim().min(1, 'Pon el nombre del proveedor').max(80);
const telefono = z
  .string()
  .trim()
  .max(30)
  .transform((v) => (v === '' ? null : v))
  .nullish();

/** Texto opcional: vacío = sin dato. */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();
const ficha = {
  telefono,
  giro: opcional(60),
  contacto: opcional(120),
  correo: z
    .string()
    .trim()
    .max(160)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.string().email('Ese correo no se ve bien').nullable())
    .nullish(),
  razonSocial: opcional(200),
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13)
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  notas: opcional(1000),
};

const crearSchema = z.object({ nombre, ...ficha });
const editarSchema = z
  .object({ nombre: nombre.optional(), ...ficha, activo: z.boolean().optional() })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'No hay nada que cambiar' });

const select = {
  id: true,
  nombre: true,
  telefono: true,
  giro: true,
  contacto: true,
  correo: true,
  razonSocial: true,
  rfc: true,
  notas: true,
  activo: true,
  createdAt: true,
} as const;

/** Un producto del proveedor y su comisión pactada (% del subtotal sin IVA o monto). */
const productoBase = z.object({
  nombre: z.string().trim().min(1, 'Pon el nombre del producto').max(120),
  precio: montoNoNegativoSchema.nullish(),
  comisionPct: z.number().min(0).max(100).nullish(),
  comisionMonto: montoNoNegativoSchema.nullish(),
});
const productoSchema = productoBase.refine(unaComision.check, unaComision.opts);
const editarProductoSchema = productoBase
  .partial()
  .extend({ activo: z.boolean().optional() })
  .refine(unaComision.check, unaComision.opts)
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'No hay nada que cambiar' });
const selectProducto = {
  id: true,
  proveedorId: true,
  nombre: true,
  precio: true,
  comisionPct: true,
  comisionMonto: true,
  activo: true,
} as const;

/** El nombre es único: dos "Dulces Lupita" partirían sus servicios en dos. La
 *  base lo exige exacto; aquí se revisa sin mayúsculas, para avisar antes. */
const esDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function proveedorRoutes(app: FastifyInstance): Promise<void> {
  const nombreTomado = async (n: string, salvo?: string) =>
    (await app.prisma.proveedor.count({
      where: { nombre: { equals: n, mode: 'insensitive' }, ...(salvo ? { id: { not: salvo } } : {}) },
    })) > 0;
  const DUPLICADO = { error: 'Ya existe un proveedor con ese nombre' };

  /**
   * El apartado "Proveedores": cada uno con su ficha, sus productos (también los
   * desactivados, marcados) y los servicios del catálogo vigente que da. Lo ve
   * cualquier usuario: ventas escoge de aquí al vender.
   */
  app.get('/proveedores', { preHandler: requireAuth }, async () => {
    const proveedores = await app.prisma.proveedor.findMany({
      select: {
        ...select,
        productos: { select: selectProducto, orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] },
        servicios: {
          where: { priceList: { activa: true } },
          select: { id: true, nombre: true, price: true, kind: true, comisionPct: true, activo: true, priceList: { select: { nombre: true } } },
          orderBy: { nombre: 'asc' },
        },
      },
      orderBy: { nombre: 'asc' },
    });
    return {
      proveedores: proveedores.map(({ servicios, ...p }) => ({
        ...p,
        // Los del catálogo vigente que da (su precio es sin IVA, como en el catálogo).
        serviciosCatalogo: servicios.map(({ priceList, ...s }) => ({ ...s, catalogo: priceList.nombre })),
      })),
    };
  });

  app.get('/admin/proveedores', { preHandler: requireAdmin }, async () => ({
    proveedores: await app.prisma.proveedor.findMany({
      select: { ...select, _count: { select: { servicios: true } } },
      orderBy: { nombre: 'asc' },
    }),
  }));

  app.post('/admin/proveedores', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = crearSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    if (await nombreTomado(parsed.data.nombre)) return reply.code(409).send(DUPLICADO);
    try {
      const proveedor = await app.prisma.proveedor.create({ data: parsed.data, select });
      return reply.code(201).send({ proveedor });
    } catch (e) {
      if (esDuplicado(e)) return reply.code(409).send(DUPLICADO);
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>('/admin/proveedores/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = editarSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    const existe = await app.prisma.proveedor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) return reply.code(404).send({ error: 'Proveedor no encontrado' });
    if (parsed.data.nombre && (await nombreTomado(parsed.data.nombre, req.params.id))) return reply.code(409).send(DUPLICADO);
    try {
      const proveedor = await app.prisma.proveedor.update({ where: { id: req.params.id }, data: parsed.data, select });
      return { proveedor };
    } catch (e) {
      if (esDuplicado(e)) return reply.code(409).send(DUPLICADO);
      throw e;
    }
  });

  const PRODUCTO_DUPLICADO = { error: 'Ese proveedor ya tiene un producto con ese nombre' };
  const productoTomado = async (proveedorId: string, n: string, salvo?: string) =>
    (await app.prisma.productoProveedor.count({
      where: { proveedorId, nombre: { equals: n, mode: 'insensitive' }, ...(salvo ? { id: { not: salvo } } : {}) },
    })) > 0;

  app.post<{ Params: { id: string } }>('/admin/proveedores/:id/productos', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = productoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
    const existe = await app.prisma.proveedor.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) return reply.code(404).send({ error: 'Proveedor no encontrado' });
    if (await productoTomado(req.params.id, parsed.data.nombre)) return reply.code(409).send(PRODUCTO_DUPLICADO);
    try {
      const producto = await app.prisma.productoProveedor.create({
        data: { ...parsed.data, proveedorId: req.params.id },
        select: selectProducto,
      });
      return reply.code(201).send({ producto });
    } catch (e) {
      if (esDuplicado(e)) return reply.code(409).send(PRODUCTO_DUPLICADO);
      throw e;
    }
  });

  app.patch<{ Params: { id: string; productoId: string } }>(
    '/admin/proveedores/:id/productos/:productoId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = editarProductoSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos', issues: parsed.error.issues });
      const actual = await app.prisma.productoProveedor.findFirst({
        where: { id: req.params.productoId, proveedorId: req.params.id },
        select: { id: true, comisionPct: true, comisionMonto: true },
      });
      if (!actual) return reply.code(404).send({ error: 'Producto no encontrado' });
      if (parsed.data.nombre && (await productoTomado(req.params.id, parsed.data.nombre, actual.id))) {
        return reply.code(409).send(PRODUCTO_DUPLICADO);
      }
      // Cambiar la comisión de forma (de % a monto) deja la otra en null: nunca las dos.
      const data = { ...parsed.data };
      if (data.comisionPct != null) data.comisionMonto = null;
      if (data.comisionMonto != null) data.comisionPct = null;
      try {
        const producto = await app.prisma.productoProveedor.update({ where: { id: actual.id }, data, select: selectProducto });
        return { producto };
      } catch (e) {
        if (esDuplicado(e)) return reply.code(409).send(PRODUCTO_DUPLICADO);
        throw e;
      }
    },
  );
}
