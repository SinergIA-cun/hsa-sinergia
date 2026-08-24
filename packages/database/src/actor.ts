import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Quién está detrás de la petición que está corriendo ahora mismo.
 *
 * Existe para que los triggers de auditoría de Postgres puedan escribir un
 * nombre. El trigger ve la fila que cambió, pero no tiene forma de saber que
 * detrás del cliente de base de datos hay una persona: para él, todo lo que
 * llega por la API es el mismo usuario `hsa`.
 *
 * El puente es `SET LOCAL app.actor_id` dentro de la MISMA transacción que la
 * escritura. Con eso:
 *
 * - Cambio hecho desde la app → queda con el id de la persona.
 * - Cambio hecho por SQL directo → queda **sin actor**, que es exactamente la
 *   señal que se busca: *esto no vino de la app*.
 *
 * Se guarda en `AsyncLocalStorage` y no en un parámetro porque el actor tendría
 * que atravesar 73 llamadas de escritura repartidas en una docena de servicios
 * para llegar al cliente de Prisma. Un contexto por petición hace ese viaje sin
 * tocar ninguna firma.
 *
 * El objeto es MUTABLE a propósito: el contexto se abre en el primer hook de la
 * petición, cuando todavía no se ha leído la cookie, y el actor se sella unos
 * milisegundos después, cuando el token ya se validó.
 */
export interface ContextoActor {
  /** Id del usuario, o `null` si la petición es anónima (login, enlaces públicos). */
  actorId: string | null;
  /**
   * Ya hay una transacción abierta por `enTransaccionConActor`, que se encarga
   * de sellar el actor. Sin esta bandera, cada escritura de adentro abriría su
   * PROPIA transacción y saldría de la del bloque: el reparto de un depósito
   * dejaría de ser atómico sin que nadie lo notara.
   */
  enTransaccion?: boolean;
}

const almacen = new AsyncLocalStorage<ContextoActor>();

/** Corre `fn` con un contexto de actor propio. Lo llama la API una vez por petición. */
export function conContextoActor<T>(ctx: ContextoActor, fn: () => T): T {
  return almacen.run(ctx, fn);
}

/** El contexto de la petición en curso, o `undefined` fuera de una (scripts, tests). */
export function contextoActor(): ContextoActor | undefined {
  return almacen.getStore();
}
