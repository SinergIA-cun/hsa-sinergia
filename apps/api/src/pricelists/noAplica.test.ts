import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@hsa/database';
import { createQuote, type Actor } from '../quotes/service.js';
import { clonarCatalogo } from './service.js';
import { editarRentas } from './editar.js';
import { borrarCatalogoDePrueba } from './testSupport.js';

/**
 * "Necesito poder desactivar cosas en la lista de precios: viernes especial a
 * veces no lo queremos ofrecer, o en renta plana viernes y sábado no se ofrece.
 * Ahorita se marca en ceros" (el dueño). Un precio `null` es "no aplica".
 */

const SUF = randomUUID().slice(0, 8);
let admin: Actor;
let arcosId: string;
let eventTypeId: string;
let catalogoId: string;
const catalogos: string[] = [];
const quotes: string[] = [];
const clients: string[] = [];

beforeAll(async () => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@haciendasanandres.com.mx' } });
  admin = { id: u.id, role: 'admin' };
  arcosId = (await prisma.space.findFirstOrThrow({ where: { nombre: 'Arcos' } })).id;
  eventTypeId = (await prisma.eventType.findFirstOrThrow({ where: { slug: 'boda' } })).id;
  const activo = await prisma.priceList.findFirstOrThrow({ where: { activa: true } });
  const clon = await clonarCatalogo(prisma, { nombre: `NO-APLICA-${SUF}`, anio: 2090, clonarDe: activo.id });
  catalogoId = clon.id;
  catalogos.push(clon.id);
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { quoteId: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.client.deleteMany({ where: { id: { in: clients } } });
  for (const id of catalogos) await borrarCatalogoDePrueba(prisma, id);
});

/** El renglón de Arcos de 101–200 del catálogo de prueba. */
const renglon = () =>
  prisma.rentalPrice.findFirstOrThrow({ where: { priceListId: catalogoId, spaceId: arcosId, tipo: 'dia', min: 101 } });

const cotizar = async (fecha: string) => {
  const q = await createQuote(
    prisma,
    { fecha, invitados: 150, spaceIds: [arcosId], eventTypeId, client: { nombre: 'No Aplica', telefono: '5512345678' } },
    admin,
    { priceListId: catalogoId },
  );
  quotes.push(q.id);
  clients.push(q.clientId);
  return q;
};

describe('precio de renta "no aplica"', () => {
  it('se guarda en null y queda en la bitácora del catálogo', async () => {
    const r = await renglon();
    await editarRentas(prisma, catalogoId, {
      cambios: [{ id: r.id, viernes: r.viernes, viernesEspecial: null, sabado: null, domAJue: r.domAJue }],
    }, admin);
    const despues = await renglon();
    expect(despues.viernesEspecial).toBeNull();
    expect(despues.sabado).toBeNull();
  });

  it('un sábado que no aplica no se cotiza; el viernes especial se cobra como viernes normal', async () => {
    const r = await renglon();
    await expect(cotizar('2090-05-06')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Arcos no se ofrece en sábado') }); // sábado
    const viernesDeMayo = await cotizar('2090-05-05');
    expect(viernesDeMayo.rentaTotal).toBe(r.viernes);
  });

  it('clonar un catálogo conserva el "no aplica" (no lo vuelve cero)', async () => {
    const clon = await clonarCatalogo(prisma, {
      nombre: `NO-APLICA-CLON-${SUF}`, anio: 2091, clonarDe: catalogoId, incrementoPct: 10,
    });
    catalogos.push(clon.id);
    const r = await prisma.rentalPrice.findFirstOrThrow({ where: { priceListId: clon.id, spaceId: arcosId, tipo: 'dia', min: 101 } });
    expect(r.sabado).toBeNull();
    expect(r.viernesEspecial).toBeNull();
    expect(r.viernes).not.toBeNull();
  });
});
