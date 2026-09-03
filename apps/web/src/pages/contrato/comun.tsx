import type { QuoteDetail } from '../../lib/types.ts';
import { MARCA } from '../../lib/marca.ts';

/**
 * Lo que comparten las dos versiones del clausulado.
 *
 * El contrato existe en dos: el de Hacienda San Andrés —el de verdad, el que se
 * firma— y uno neutro para el demo de ventas. Las páginas 1 y 2 son iguales en
 * los dos (las partes, la descripción del evento y las tablas de precio: eso es
 * lo que el sistema llena, y es lo que la demo quiere enseñar). De la página 3
 * en adelante cambian los TÉRMINOS, y ahí se bifurca.
 */

/** El espacio en blanco de los campos que se llenan a mano al imprimir. */
export const BLANK = '________________';

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Lo que necesita el clausulado, ya calculado por la página. */
export interface ClausulasProps {
  quote: QuoteDetail['quote'];
  estadoCuenta: QuoteDetail['estadoCuenta'];
  /** Los hitos del plan de pagos, ya buscados por llave. */
  plan: QuoteDetail['estadoCuenta']['plan'];
  hitoApartar: NonNullable<QuoteDetail['estadoCuenta']['plan']>[number] | undefined;
  hitoComplemento: NonNullable<QuoteDetail['estadoCuenta']['plan']>[number] | undefined;
  hitoFiniquito: NonNullable<QuoteDetail['estadoCuenta']['plan']>[number] | undefined;
  espaciosById: Map<string, string>;
  /** El día en que se imprime, para la fecha de firma. */
  hoy: Date;
  vendedor: string;
}

export function Foot() {
  return (
    <div className="foot">
      {MARCA.direccion}. Tel {MARCA.telefono}
      {MARCA.telefono2 ? ` y ${MARCA.telefono2}` : ''}
      <br />
      {MARCA.sitio}
    </div>
  );
}
