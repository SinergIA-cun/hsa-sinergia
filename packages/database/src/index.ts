import { PrismaClient, Prisma } from '@prisma/client';
import { contextoActor, type ContextoActor } from './actor.js';

export * from './actor.js';

/**
 * Le pone nombre a la conexión.
 *
 * `application_name` viaja hasta Postgres y el trigger de auditoría lo graba.
 * Es la mitad barata de la respuesta a "¿esto vino de la app o lo metió alguien
 * a mano?": lo que entra por aquí dice `hsa-api`, lo que entra por psql dice
 * `psql`. Se pone en código y no en el `.env` para que no dependa de que
 * alguien se acuerde de configurarlo en el servidor.
 */
/**
 * Cómo se identifica esta aplicación ante Postgres.
 *
 * Es la frontera entre "lo escribió nuestro código" y "lo escribió alguien más".
 * La bitácora forense la usa para clasificar el origen de cada cambio, así que
 * cambiar este texto sin actualizar la consulta volvería externo todo lo propio.
 */
export const NOMBRE_APP = 'hsa-api';

function urlConNombreDeApp(cruda: string | undefined): string | undefined {
  if (!cruda) return undefined;
  try {
    const url = new URL(cruda);
    if (!url.searchParams.has('application_name')) {
      url.searchParams.set('application_name', NOMBRE_APP);
    }
    return url.toString();
  } catch {
    // Una cadena que no parsea es problema de la configuración, no de aquí:
    // se deja pasar tal cual para que Prisma dé el error de siempre.
    return cruda;
  }
}

const url = urlConNombreDeApp(process.env.DATABASE_URL);
const base = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();

/** Operaciones que cambian datos y por lo tanto disparan el trigger de auditoría. */
const ESCRITURAS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * El cliente de Prisma con el sello del actor.
 *
 * Cada escritura viaja acompañada de un `set_config('app.actor_id', …, TRUE)`
 * **en la misma transacción**, que es la única forma de que el trigger lo vea:
 * `SET LOCAL` muere al terminar la transacción, así que no hay riesgo de que el
 * actor de una petición se le pegue a la siguiente por reuso de conexión —que
 * es precisamente lo que pasaría con un `SET` de sesión sobre un pool.
 *
 * Las lecturas pasan de largo: no disparan triggers y no vale la pena volverlas
 * transacciones.
 *
 * La afirmación de tipo del final no es cosmética ni floja: un cliente extendido
 * es un `PrismaClient` completo MENOS `$on` y `$use`, dos APIs obsoletas que este
 * código no usa en ningún lado (verificado). Sin ella, las ~25 firmas que ya
 * piden `PrismaClient` tendrían que cambiar de tipo por dos métodos que nadie
 * llama. Si algún día hace falta `$on`, esto truena en tiempo de ejecución y no
 * de compilación: por eso queda escrito aquí.
 */
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query, operation }) {
        const ctx = contextoActor();
        // Sin actor conocido (scripts, migraciones, tests) o ya dentro de una
        // transacción que lo selló, la operación va tal cual.
        if (!ctx?.actorId || ctx.enTransaccion || !ESCRITURAS.has(operation)) {
          return query(args);
        }
        const [, resultado] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.actor_id', ${ctx.actorId}, TRUE)`,
          query(args) as Prisma.PrismaPromise<unknown>,
        ]);
        return resultado;
      },
    },
  },
}) as unknown as PrismaClient;

/**
 * Abre una transacción con el actor ya sellado.
 *
 * Hoy no hay ninguna, pero en cuanto exista una —el reparto de un depósito es
 * la candidata— tiene que usar esto y no `prisma.$transaction` a secas: la
 * bandera `enTransaccion` es lo que evita que cada escritura de adentro abra su
 * propia transacción y se salga de la de afuera.
 */
export async function enTransaccionConActor<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ctx = contextoActor();
  return prisma.$transaction(async (tx) => {
    if (ctx?.actorId) {
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${ctx.actorId}, TRUE)`;
      ctx.enTransaccion = true;
    }
    try {
      return await fn(tx);
    } finally {
      if (ctx) ctx.enTransaccion = false;
    }
  });
}

export type { ContextoActor };
export * from '@prisma/client';
