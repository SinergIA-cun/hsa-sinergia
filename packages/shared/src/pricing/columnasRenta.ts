/**
 * Las columnas de la tabla de renta (16-oct-2026): antes eran cuatro fijas
 * —viernes, viernes especial, sábado y domingo a jueves— y la regla de qué fecha
 * caía en cuál vivía en el código. Ahora cada catálogo tiene las suyas, con su
 * regla a la vista: **qué días de la semana y en qué meses** se cobra con ella.
 *
 * Cuando una fecha cae en dos columnas, gana la MÁS ESPECÍFICA: la que trae
 * meses sobre la de "todo el año", y entre dos con meses, la de menos meses.
 * Así "Viernes especial (vie · mar–may, sep–oct)" le gana a "Viernes (vie · todo
 * el año)" sin que nadie tenga que ordenarlas. Un empate verdadero —dos columnas
 * igual de específicas para el mismo día y mes— no se puede guardar: ver
 * `validarColumnas`.
 *
 * Una fecha que no cae en ninguna columna no se ofrece: el cotizador avisa.
 */

export interface ColumnaRenta {
  /** Llave estable de la columna dentro del catálogo; los precios se guardan por ella. */
  clave: string;
  nombre: string;
  /** Días de la semana: 0 = domingo … 6 = sábado. */
  dias: number[];
  /** Meses 1–12. Vacío = todo el año. */
  meses: number[];
  /**
   * Si el renglón no tiene precio en esta columna, se cobra con el de esta otra
   * (la del viernes especial cae al viernes normal: es una promoción). `null` =
   * sin precio, ese día no se ofrece.
   */
  respaldo: string | null;
}

export const NOMBRE_DIA_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
const PLURAL_DIA_SEMANA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'] as const;
export const INICIAL_DIA_SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'] as const;
export const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/**
 * Las cuatro de siempre, con la regla que tenía el código. Un catálogo que no
 * tiene columnas guardadas usa estas: así lo ya cotizado cobra exactamente igual.
 */
export const COLUMNAS_BASE: readonly ColumnaRenta[] = [
  { clave: 'viernes', nombre: 'Viernes', dias: [5], meses: [], respaldo: null },
  { clave: 'viernesEspecial', nombre: 'Viernes especial', dias: [5], meses: [3, 4, 5, 9, 10], respaldo: 'viernes' },
  { clave: 'sabado', nombre: 'Sábado', dias: [6], meses: [], respaldo: null },
  { clave: 'domAJue', nombre: 'Dom a jue', dias: [0, 1, 2, 3, 4], meses: [], respaldo: null },
];

/** Día de la semana (0 = domingo) y mes (1–12) de una fecha `AAAA-MM-DD`, sin zona horaria. */
export function diaYMes(fechaISO: string): { dia: number; mes: number } {
  const [y, m, d] = fechaISO.split('-').map(Number) as [number, number, number];
  return { dia: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), mes: m };
}

/** Qué tan específica es una columna para un mes dado: más alto gana. */
const especificidad = (c: ColumnaRenta): number => (c.meses.length === 0 ? 0 : 13 - c.meses.length);

const aplica = (c: ColumnaRenta, dia: number, mes: number): boolean =>
  c.dias.includes(dia) && (c.meses.length === 0 || c.meses.includes(mes));

/** Las columnas que ganan para un día y mes (más de una = empate). */
function ganadoras(columnas: readonly ColumnaRenta[], dia: number, mes: number): ColumnaRenta[] {
  const candidatas = columnas.filter((c) => aplica(c, dia, mes));
  if (candidatas.length === 0) return [];
  const tope = Math.max(...candidatas.map(especificidad));
  return candidatas.filter((c) => especificidad(c) === tope);
}

/** La columna con la que se cobra una fecha, o `null` si no cae en ninguna. */
export function columnaDeFecha(columnas: readonly ColumnaRenta[], fechaISO: string): ColumnaRenta | null {
  const { dia, mes } = diaYMes(fechaISO);
  return ganadoras(columnas, dia, mes)[0] ?? null;
}

/**
 * El precio de un renglón en una columna, con su respaldo si no tiene. `null` =
 * no se ofrece. El respaldo es de UN salto: una cadena de respaldos sería una
 * regla que nadie puede leer en la tabla.
 */
export function precioEnColumna(
  precios: Readonly<Record<string, number | null | undefined>>,
  columna: ColumnaRenta,
): number | null {
  const p = precios[columna.clave];
  if (p != null) return p;
  return columna.respaldo ? precios[columna.respaldo] ?? null : null;
}

/** "vie · mar–may, sep–oct" — la regla de una columna, para leerla de un vistazo. */
export function describirRegla(c: Pick<ColumnaRenta, 'dias' | 'meses'>): string {
  const dias = rangos([...c.dias].sort((a, b) => a - b), (d) => NOMBRE_DIA_SEMANA[d]!.slice(0, 3));
  const meses = c.meses.length === 0 ? 'todo el año' : rangos([...c.meses].sort((a, b) => a - b), (m) => NOMBRE_MES[m - 1]!.slice(0, 3));
  return `${dias || 'ningún día'} · ${meses}`;
}

function rangos(xs: number[], nombre: (n: number) => string): string {
  const out: string[] = [];
  let i = 0;
  while (i < xs.length) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j]! + 1) j++;
    out.push(j - i >= 2 ? `${nombre(xs[i]!)}–${nombre(xs[j]!)}` : xs.slice(i, j + 1).map(nombre).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}

export interface RevisionColumnas {
  /** No se puede guardar. */
  errores: string[];
  /** Se puede guardar, pero conviene saberlo: días que no se ofrecen. */
  avisos: string[];
}

/** Revisa nombres, reglas, respaldos, empates y días sin columna. */
export function validarColumnas(columnas: readonly ColumnaRenta[]): RevisionColumnas {
  const errores: string[] = [];
  const avisos: string[] = [];
  if (columnas.length === 0) errores.push('La tabla necesita al menos una columna.');

  const nombres = new Set<string>();
  for (const c of columnas) {
    const n = c.nombre.trim();
    if (!n) errores.push('Hay una columna sin nombre.');
    else if (nombres.has(n.toLowerCase())) errores.push(`Hay dos columnas que se llaman "${n}".`);
    nombres.add(n.toLowerCase());
    if (c.dias.length === 0) errores.push(`"${n || 'Sin nombre'}" no tiene ningún día de la semana.`);
    if (c.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errores.push(`"${n}" tiene un día inválido.`);
    if (c.meses.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) errores.push(`"${n}" tiene un mes inválido.`);
    if (c.respaldo != null) {
      if (c.respaldo === c.clave) errores.push(`"${n}" no puede cobrarse como ella misma.`);
      else if (!columnas.some((o) => o.clave === c.respaldo)) errores.push(`"${n}" se cobra como una columna que ya no existe.`);
    }
  }

  // Empates y huecos, por día de la semana y mes.
  const empates = new Map<string, number[]>(); // "A y B · viernes" → meses
  const huecos = new Map<number, number[]>(); // día → meses sin columna
  for (let dia = 0; dia < 7; dia++) {
    for (let mes = 1; mes <= 12; mes++) {
      const g = ganadoras(columnas, dia, mes);
      if (g.length === 0) huecos.set(dia, [...(huecos.get(dia) ?? []), mes]);
      if (g.length > 1) {
        const k = `${g.map((c) => `"${c.nombre}"`).join(' y ')}|${dia}`;
        empates.set(k, [...(empates.get(k) ?? []), mes]);
      }
    }
  }
  for (const [k, meses] of empates) {
    const [quienes, dia] = k.split('|');
    errores.push(
      `${quienes} cobran los ${PLURAL_DIA_SEMANA[Number(dia)]}${meses.length === 12 ? '' : ` de ${describirRegla({ dias: [], meses }).split(' · ')[1]}`}: deja la regla de una sola.`,
    );
  }
  for (const [dia, meses] of huecos) {
    avisos.push(
      `Los ${PLURAL_DIA_SEMANA[dia]}${meses.length === 12 ? '' : ` de ${describirRegla({ dias: [], meses }).split(' · ')[1]}`} no caen en ninguna columna: no se ofrecen.`,
    );
  }
  return { errores, avisos };
}
