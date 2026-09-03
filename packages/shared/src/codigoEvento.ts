/**
 * Código de evento: la identidad legible de un evento, del formato que pidió el
 * dueño — `17ENE27-CBOLADO-CUPULA`: día, mes abreviado, los dos dígitos del
 * año, inicial del nombre + apellido, y el espacio abreviado.
 *
 * Función PURA: no toca la base ni resuelve colisiones. La unicidad (el sufijo
 * `-2`, `-3`) y el congelado al formalizar viven en el servicio, porque
 * necesitan la base de datos.
 *
 * Reglas fijadas (los tests son la especificación):
 * - **Día**: los dos dígitos del ISO, tal cual (`04JUL27`, no `4JUL27`).
 * - **Mes**: abreviatura en español de tres letras.
 * - **Año**: los DOS últimos dígitos, pegados al mes. Sin ellos el código se
 *   repetía cada año —`29OCT-CBARRERA-CUPULA` era el de 2027, el de 2028 y el
 *   de 2029— y solo quedaba el sufijo `-2`, que no dice de qué año habla.
 * - **Cliente**: con dos o más palabras, la inicial de la primera + la ÚLTIMA
 *   palabra (el apellido). Con una sola palabra, esa palabra completa.
 * - **Espacio**: la última palabra con contenido del PRIMER espacio, ignorando
 *   artículos y preposiciones ("Jardín La Cúpula" → `CUPULA`).
 * - **Normalización**: se quitan acentos, la eñe se vuelve N, todo a mayúsculas
 *   y sobrevive solo `A-Z0-9`. Un guión de más rompería el formato.
 * - **Tope**: `CODIGO_MAX_PARTE` caracteres por parte, para que el código quepa
 *   donde se va a imprimir.
 * - Una parte que se queda vacía se rellena con `NA` en vez de dejar el código
 *   con un hueco: `13NOV-NA-NA` se lee mal a propósito, y eso es mejor que un
 *   identificador ambiguo.
 */

/** Tope de caracteres de la parte del cliente y de la del espacio. */
export const CODIGO_MAX_PARTE = 12;

/** Lo que se pone cuando una parte se queda sin contenido. */
const RELLENO = 'NA';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** Artículos y preposiciones que no distinguen a un espacio de otro. */
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'A']);

export interface CodigoEventoInput {
  /** Fecha del evento en `YYYY-MM-DD`. */
  fechaISO: string;
  /** Nombre del cliente tal como está capturado. */
  cliente: string;
  /** Nombres de los espacios del evento. **Manda el primero.** */
  espacios: string[];
}

/** Mayúsculas sin acentos ni eñes, y solo `A-Z0-9`. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // acentos y la virgulilla de la ñ
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Palabras normalizadas, sin las vacías. */
function palabras(texto: string): string[] {
  return texto
    .split(/\s+/)
    .map(normalizar)
    .filter((p) => p.length > 0);
}

function parteCliente(cliente: string): string {
  const ps = palabras(cliente);
  if (ps.length === 0) return RELLENO;
  // Una sola palabra: entra completa (no hay apellido que abreviar).
  if (ps.length === 1) return ps[0]!.slice(0, CODIGO_MAX_PARTE);
  const inicial = ps[0]![0]!;
  const apellido = ps[ps.length - 1]!;
  return `${inicial}${apellido}`.slice(0, CODIGO_MAX_PARTE);
}

function parteEspacio(espacios: string[]): string {
  // El PRIMERO manda: un evento con dos salones tiene un solo código.
  const ps = palabras(espacios[0] ?? '');
  // De atrás hacia adelante, la primera que no sea artículo ni preposición.
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i]!;
    if (!VACIAS.has(p)) return p.slice(0, CODIGO_MAX_PARTE);
  }
  // Todo era artículo: mejor la última palabra que un relleno.
  const ultima = ps[ps.length - 1];
  return ultima ? ultima.slice(0, CODIGO_MAX_PARTE) : RELLENO;
}

export function codigoEvento({ fechaISO, cliente, espacios }: CodigoEventoInput): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) throw new Error(`Fecha inválida para el código de evento: ${fechaISO}`);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    throw new Error(`Fecha inválida para el código de evento: ${fechaISO}`);
  }
  // Los dos últimos dígitos del año: `2027` → `27`. Un evento a 100 años vista
  // volvería a chocar, y eso está bien: no es el negocio de nadie.
  const anio = m[1]!.slice(2);
  return `${m[3]}${MESES[mes - 1]}${anio}-${parteCliente(cliente)}-${parteEspacio(espacios)}`;
}
