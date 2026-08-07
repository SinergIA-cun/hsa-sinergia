import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Compara en tiempo constante. `timingSafeEqual` exige buffers del mismo largo,
 * así que la diferencia de longitud se resuelve antes — y esa comparación previa
 * solo revela el largo de la llave, no su contenido.
 */
function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Guardia del API del BI. La llave nunca se escribe en logs ni en la respuesta:
 * el 401 es genérico a propósito.
 */
export function requireApiKey(esperada: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const recibida = req.headers['x-api-key'];
    if (typeof recibida !== 'string' || !igual(recibida, esperada)) {
      return reply.code(401).send({ error: 'Llave de API inválida o ausente.' });
    }
  };
}
