import { prisma } from '@hsa/database';
import { codigoEvento } from '@hsa/shared';

/**
 * Genera el código de evento (`17ENE-CBOLADO-CUPULA`) de las cotizaciones que
 * nacieron antes de que la columna existiera.
 *
 * IDEMPOTENTE por partida doble:
 *  · solo toca las que tienen `codigo` en NULL, así que la segunda corrida
 *    reporta 0;
 *  · y NUNCA reescribe un código ya asignado — un código ya asignado puede estar
 *    impreso en un recibo o un contrato, y cambiarlo sería peor que no tenerlo.
 *
 * Incluye las de la papelera: una cotización eliminada sigue siendo evidencia de
 * auditoría y su recibo puede andar circulando.
 *
 * El orden es por `createdAt`: cuando dos eventos comparten cliente, fecha y
 * salón, el sufijo (`-2`, `-3`) le toca al más nuevo, que es la misma regla que
 * aplica el servicio al crear.
 *
 * Vive en la API y no en `packages/database` porque necesita `@hsa/shared` (la
 * función pura del código), y el paquete de base de datos no depende de shared.
 *
 * Uso (en el contenedor de la API, con DATABASE_URL en el entorno):
 *   pnpm --filter @hsa/api exec tsx src/scripts/backfill-codigo-evento.ts
 */
async function main(): Promise<void> {
  const pendientes = await prisma.quote.findMany({
    where: { codigo: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fechaEvento: true,
      spaceIds: true,
      client: { select: { nombre: true } },
    },
  });

  if (pendientes.length === 0) {
    const total = await prisma.quote.count();
    console.log(`Todas las cotizaciones ya tienen código (${total} en total): 0 generados.`);
    return;
  }

  const spaces = await prisma.space.findMany({ select: { id: true, nombre: true } });
  const nombreEspacio = new Map(spaces.map((s) => [s.id, s.nombre]));

  let generados = 0;
  for (const q of pendientes) {
    const base = codigoEvento({
      fechaISO: q.fechaEvento.toISOString().slice(0, 10),
      cliente: q.client?.nombre ?? '',
      // En el ORDEN de `spaceIds`: manda el primero, y `findMany` no ordena.
      espacios: q.spaceIds.map((id) => nombreEspacio.get(id) ?? ''),
    });
    // La consulta va DENTRO del ciclo a propósito: los códigos que este mismo
    // script acaba de escribir tienen que contar para el sufijo del siguiente.
    const usados = new Set(
      (
        await prisma.quote.findMany({
          where: { OR: [{ codigo: base }, { codigo: { startsWith: `${base}-` } }] },
          select: { codigo: true },
        })
      ).map((x) => x.codigo),
    );
    let codigo = base;
    for (let n = 2; usados.has(codigo); n++) codigo = `${base}-${n}`;

    await prisma.quote.update({ where: { id: q.id }, data: { codigo } });
    generados += 1;
    console.log(`  ${q.id} → ${codigo}`);
  }

  const sinCodigo = await prisma.quote.count({ where: { codigo: null } });
  console.log(`\n${generados} código(s) generados; quedan ${sinCodigo} sin código.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill del código de evento falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
