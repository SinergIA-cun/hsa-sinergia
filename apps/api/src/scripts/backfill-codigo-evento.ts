import { prisma } from '@hsa/database';
import { codigoEvento } from '@hsa/shared';

/**
 * Códigos de evento (`17ENE27-CBOLADO-CUPULA`). Dos trabajos en un solo script,
 * porque los dos necesitan la misma resolución de sufijos contra la base:
 *
 *  1. **Generar** el código de las cotizaciones que nacieron antes de que la
 *     columna existiera (`codigo` en NULL). Es lo que hace por omisión.
 *  2. **Rehacer** el código de las que todavía NO apartan la fecha, para que
 *     lleven el año (`--con-anio`). Sin esto, un borrador viejo se queda con el
 *     formato sin año hasta que alguien lo edite, y si lo formalizan sin
 *     editarlo el código se CONGELA sin año — justo lo que el año vino a evitar.
 *
 * IDEMPOTENTE en las dos:
 *  · la primera solo toca `codigo` en NULL, así que la segunda corrida da 0;
 *  · la segunda solo toca códigos que NO traen año, así que repetirla da 0.
 *
 * Lo que NUNCA se reescribe, ni con `--con-anio`:
 *  · una cotización que aparta la fecha (formalizada, complementada, liquidada):
 *    su código ya está impreso en el contrato;
 *  · una cotización CON PAGOS, cualquiera sea su estatus: el código sale en el
 *    recibo, y el recibo ya anda circulando.
 * Cambiar uno de esos códigos sería peor que dejarlo sin año.
 *
 * La primera pasada sí incluye las de la papelera: una cotización eliminada
 * sigue siendo evidencia de auditoría y su recibo puede andar circulando.
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
 *   pnpm --filter @hsa/api exec tsx src/scripts/backfill-codigo-evento.ts --con-anio
 */

/** Estatus que apartan la fecha: su código ya está impreso y no se toca. */
const APARTAN = ['formalizada', 'complementada', 'liquidada'] as const;

/** Un código que ya trae los dos dígitos del año: `29OCT27-…`. */
const CON_ANIO = /^\d{2}[A-Z]{3}\d{2}-/;

interface Pendiente {
  id: string;
  codigo: string | null;
  fechaEvento: Date;
  spaceIds: string[];
  client: { nombre: string } | null;
}

const SELECT = {
  id: true,
  codigo: true,
  fechaEvento: true,
  spaceIds: true,
  client: { select: { nombre: true } },
} as const;

/**
 * Escribe el código de una cotización, resolviendo el sufijo contra la base.
 *
 * La consulta va DENTRO del ciclo a propósito: los códigos que este mismo
 * script acaba de escribir tienen que contar para el sufijo del siguiente.
 */
async function asignar(q: Pendiente, nombreEspacio: Map<string, string>): Promise<string> {
  const base = codigoEvento({
    fechaISO: q.fechaEvento.toISOString().slice(0, 10),
    cliente: q.client?.nombre ?? '',
    // En el ORDEN de `spaceIds`: manda el primero, y `findMany` no ordena.
    espacios: q.spaceIds.map((id) => nombreEspacio.get(id) ?? ''),
  });
  const usados = new Set(
    (
      await prisma.quote.findMany({
        where: {
          OR: [{ codigo: base }, { codigo: { startsWith: `${base}-` } }],
          // El código que la cotización trae hoy no compite consigo mismo.
          id: { not: q.id },
        },
        select: { codigo: true },
      })
    ).map((x) => x.codigo),
  );
  let codigo = base;
  for (let n = 2; usados.has(codigo); n++) codigo = `${base}-${n}`;

  await prisma.quote.update({ where: { id: q.id }, data: { codigo } });
  return codigo;
}

async function generarFaltantes(nombreEspacio: Map<string, string>): Promise<number> {
  const pendientes = await prisma.quote.findMany({
    where: { codigo: null },
    orderBy: { createdAt: 'asc' },
    select: SELECT,
  });

  if (pendientes.length === 0) {
    const total = await prisma.quote.count();
    console.log(`Todas las cotizaciones ya tienen código (${total} en total): 0 generados.`);
    return 0;
  }

  for (const q of pendientes) {
    console.log(`  ${q.id} → ${await asignar(q, nombreEspacio)}`);
  }
  return pendientes.length;
}

async function rehacerSinAnio(nombreEspacio: Map<string, string>): Promise<number> {
  const candidatas = await prisma.quote.findMany({
    where: {
      codigo: { not: null },
      status: { notIn: [...APARTAN] },
      // Un pago significa un recibo con el código impreso.
      payments: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
    select: SELECT,
  });
  const sinAnio = candidatas.filter((q) => q.codigo != null && !CON_ANIO.test(q.codigo));

  if (sinAnio.length === 0) {
    console.log('Ningún código pendiente de año entre las que no apartan la fecha: 0 rehechos.');
    return 0;
  }

  for (const q of sinAnio) {
    const antes = q.codigo;
    console.log(`  ${q.id} · ${antes} → ${await asignar(q, nombreEspacio)}`);
  }
  return sinAnio.length;
}

async function main(): Promise<void> {
  const conAnio = process.argv.includes('--con-anio');

  const spaces = await prisma.space.findMany({ select: { id: true, nombre: true } });
  const nombreEspacio = new Map(spaces.map((s) => [s.id, s.nombre]));

  const generados = await generarFaltantes(nombreEspacio);
  const rehechos = conAnio ? await rehacerSinAnio(nombreEspacio) : 0;

  const sinCodigo = await prisma.quote.count({ where: { codigo: null } });
  console.log(
    `\n${generados} código(s) generados` +
      (conAnio ? `, ${rehechos} rehecho(s) con año` : ' (sin `--con-anio`: no se rehizo ninguno)') +
      `; quedan ${sinCodigo} sin código.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Backfill del código de evento falló:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
