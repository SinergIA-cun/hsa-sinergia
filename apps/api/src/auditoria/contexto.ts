import type { FastifyInstance } from 'fastify';
import { conContextoActor, contextoActor } from '@hsa/database';

/**
 * Abre un contexto de actor por petición.
 *
 * Se registra ANTES que el hook de autenticación y con la forma de callback a
 * propósito: `conContextoActor` envuelve la llamada a `done()`, y todo lo que
 * Fastify ejecute a partir de ahí —hooks, handler, servicios, escrituras de
 * Prisma— corre dentro de ese contexto. Con un hook `async` no se podría: el
 * contexto se cerraría al resolver la promesa, antes de que llegara el handler.
 *
 * El actor entra vacío porque en este punto la cookie todavía no se ha leído;
 * lo sella `sellarActor` unos milisegundos después.
 */
export function setupContextoActor(app: FastifyInstance): void {
  app.addHook('onRequest', (_req, _reply, done) => {
    conContextoActor({ actorId: null }, done);
  });
}

/** Escribe quién es la persona en el contexto de la petición en curso. */
export function sellarActor(actorId: string): void {
  const ctx = contextoActor();
  if (ctx) ctx.actorId = actorId;
}
