import { z } from 'zod';

/**
 * Las formas en que entra el dinero a la hacienda.
 *
 * Un mismo pago puede venir dividido: "toma mi tarjeta de débito y mi tarjeta de
 * crédito, a cada una cóbrale tanto". Es UN pago con UN folio, no dos, así que la
 * división vive dentro del pago (`formas`) y no como pagos separados.
 *
 * La misma forma puede repetirse ("hago 2 transferencias"), y cada parte lleva
 * una nota opcional: de qué banco vino, quién la hizo (el dueño, 5-oct-2026).
 */
export const FORMAS_PAGO = ['efectivo', 'cheque', 'transferencia', 'tarjetaDebito', 'tarjetaCredito'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];

/**
 * El `metodo` que se guarda en la columna del pago.
 *
 * `tarjeta` es de antes de separar débito y crédito: los pagos viejos lo traen y
 * no se puede adivinar cuál fue, así que se conserva tal cual y ya no se ofrece.
 * `mixto` es el de un pago dividido en dos o más formas; el detalle está en
 * `formas`.
 */
export const METODOS_PAGO = [...FORMAS_PAGO, 'tarjeta', 'mixto'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const FORMA_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  cheque: 'Cheque',
  transferencia: 'Transferencia',
  tarjetaDebito: 'Tarjeta de débito',
  tarjetaCredito: 'Tarjeta de crédito',
  tarjeta: 'Tarjeta',
  mixto: 'Varias formas',
};

/**
 * Una parte de un pago dividido. Es `type` y no `interface` a propósito: se
 * guarda en una columna JSON, y Prisma solo acepta ahí tipos con firma de índice
 * implícita, que las interfaces no tienen.
 */
export type PartePago = { forma: FormaPago; monto: number; nota?: string };

/** Lo más largo que puede ser la nota de una parte: "BBVA · ref 0043128 · pagó la tía". */
export const NOTA_PARTE_MAX = 120;

export const formaPagoSchema = z.enum(FORMAS_PAGO);

/**
 * Lo que se acepta como `metodo` al CAPTURAR: las cinco formas y, por
 * compatibilidad, `tarjeta` (una pantalla vieja todavía en caché lo manda).
 * `mixto` no se captura: sale solo cuando hay más de una forma.
 */
export const metodoCapturaSchema = z.enum([...FORMAS_PAGO, 'tarjeta']);

/**
 * Las partes de un pago dividido. Los montos son enteros: Prisma trunca los
 * flotantes al escribir, así que un decimal aquí perdería centavos en silencio.
 */
export const formasPagoSchema = z
  .array(
    z.object({
      forma: formaPagoSchema,
      monto: z.number().int().positive(),
      // En blanco no es nota: no se guarda.
      nota: z
        .string()
        .trim()
        .max(NOTA_PARTE_MAX)
        .optional()
        .transform((v) => (v ? v : undefined)),
    }),
  )
  .min(1, 'El pago necesita al menos una forma de pago.')
  .max(10, 'Un pago se divide en 10 partes como máximo.');

/** El error que se lanza cuando la captura no cuadra. */
export class FormasPagoError extends Error {}

/**
 * Normaliza lo capturado a `{ metodo, formas }`, que es lo que se guarda.
 *
 * - Con `formas`, su suma TIENE que ser el monto: un pago de $10,000 dividido en
 *   $6,000 + $3,000 es un error de captura, no un pago de $9,000.
 * - Sin `formas`, el `metodo` de siempre se vuelve una sola parte. Así las
 *   pantallas y los procesos que capturan un solo método siguen funcionando.
 * - `tarjeta` (el valor viejo) se guarda sin partes: no es ninguna de las cinco
 *   formas y no se va a inventar si fue débito o crédito.
 */
export function resolverFormasPago(args: {
  monto: number;
  metodo?: z.infer<typeof metodoCapturaSchema> | null;
  formas?: PartePago[] | null;
}): { metodo: MetodoPago; formas: PartePago[] | null } {
  const { monto, metodo, formas } = args;
  if (formas && formas.length > 0) {
    const suma = formas.reduce((s, p) => s + p.monto, 0);
    if (suma !== monto) {
      throw new FormasPagoError(
        `Las formas de pago suman $${suma.toLocaleString('es-MX')} y el pago es de $${monto.toLocaleString('es-MX')}.`,
      );
    }
    return { metodo: formas.length === 1 ? formas[0]!.forma : 'mixto', formas };
  }
  if (!metodo) throw new FormasPagoError('Falta la forma de pago.');
  if (metodo === 'tarjeta') return { metodo, formas: null };
  return { metodo, formas: [{ forma: metodo, monto }] };
}

/**
 * Las partes de un pago ya guardado, para mostrarlas o sumarlas.
 *
 * Los pagos anteriores a la división no tienen `formas`: su único método es
 * toda la parte. Devuelve `forma: MetodoPago` y no `FormaPago` porque un pago
 * viejo puede decir `tarjeta`.
 */
export function partesDePago(pago: {
  monto: number;
  metodo: string;
  formas?: unknown;
}): { forma: MetodoPago; monto: number; nota?: string }[] {
  const parsed = formasPagoSchema.safeParse(pago.formas);
  if (parsed.success) return parsed.data;
  return [{ forma: pago.metodo as MetodoPago, monto: pago.monto }];
}

/** "Transferencia $6,000 (BBVA) · Transferencia $4,000 (Santander)", o solo "Efectivo". */
export function describirFormasPago(pago: { monto: number; metodo: string; formas?: unknown }): string {
  const partes = partesDePago(pago);
  const nota = (p: { nota?: string }) => (p.nota ? ` (${p.nota})` : '');
  if (partes.length === 1) return `${FORMA_PAGO_LABEL[partes[0]!.forma] ?? partes[0]!.forma}${nota(partes[0]!)}`;
  return partes
    .map((p) => `${FORMA_PAGO_LABEL[p.forma] ?? p.forma} $${p.monto.toLocaleString('es-MX')}${nota(p)}`)
    .join(' · ');
}

/** Las partes sin sus notas: lo que puede ver el cliente (las notas son internas). */
export function formasSinNotas(formas: unknown): unknown {
  if (!Array.isArray(formas)) return formas;
  return formas.map((p) => {
    if (p == null || typeof p !== 'object') return p;
    const { nota: _nota, ...resto } = p as Record<string, unknown>;
    void _nota;
    return resto;
  });
}

/**
 * El folio impreso: la serie `I` de las hojas foliadas de la hacienda y el
 * número. `null` = un movimiento de antes de que existiera el folio (depósitos y
 * abonos viejos), que se muestra como "sin folio".
 */
export const SERIE_FOLIO = 'I';
/**
 * `I 5340`, o `I 5340-B` para la segunda aplicación de un depósito repartido: el
 * depósito es UN dinero que entró (un folio) y cada evento al que se aplica lleva
 * su letra, así cada recibo se distingue sin gastar folios.
 */
export function formatFolio(folio: number | null | undefined, letra?: string | null): string {
  if (folio == null) return 'sin folio';
  return letra ? `${SERIE_FOLIO} ${folio}-${letra}` : `${SERIE_FOLIO} ${folio}`;
}

/** La letra de la n-ésima aplicación (0 → A, 25 → Z, 26 → AA), como las columnas de Excel. */
export function letraDeAplicacion(indice: number): string {
  let n = indice;
  let letra = '';
  do {
    letra = String.fromCharCode(65 + (n % 26)) + letra;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letra;
}
