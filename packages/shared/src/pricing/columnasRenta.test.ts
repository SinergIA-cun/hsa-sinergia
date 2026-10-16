import { describe, it, expect } from 'vitest';
import { COLUMNAS_BASE, columnaDeFecha, describirRegla, precioEnColumna, validarColumnas, type ColumnaRenta } from './columnasRenta.js';
import { dayType } from './day-type.js';

describe('columnas de renta', () => {
  it('las de siempre dan la misma columna que la regla vieja, todo un año', () => {
    for (let d = new Date(Date.UTC(2027, 0, 1)); d.getUTCFullYear() === 2027; d.setUTCDate(d.getUTCDate() + 1)) {
      const f = d.toISOString().slice(0, 10);
      expect(columnaDeFecha(COLUMNAS_BASE, f)?.clave).toBe(dayType(f));
    }
  });

  it('gana la más específica: con meses sobre todo el año, y la de menos meses', () => {
    const cols: ColumnaRenta[] = [
      ...COLUMNAS_BASE,
      { clave: 'dic', nombre: 'Diciembre', dias: [5, 6], meses: [12], respaldo: 'sabado' },
    ];
    expect(columnaDeFecha(cols, '2027-12-04')?.clave).toBe('dic'); // sábado
    expect(columnaDeFecha(cols, '2027-12-03')?.clave).toBe('dic'); // viernes
    expect(columnaDeFecha(cols, '2027-11-27')?.clave).toBe('sabado');
    expect(validarColumnas(cols).errores).toEqual([]);
  });

  it('sin precio cae al respaldo (un salto)', () => {
    const ve = COLUMNAS_BASE[1]!;
    expect(precioEnColumna({ viernes: 100 }, ve)).toBe(100);
    expect(precioEnColumna({ viernes: 100, viernesEspecial: 50 }, ve)).toBe(50);
    expect(precioEnColumna({}, COLUMNAS_BASE[2]!)).toBeNull();
  });

  it('marca empates, respaldos rotos y días sin columna', () => {
    const empate = validarColumnas([...COLUMNAS_BASE, { clave: 'x', nombre: 'Otro sábado', dias: [6], meses: [], respaldo: null }]);
    expect(empate.errores.join(' ')).toMatch(/"Sábado" y "Otro sábado" cobran los sábados/);
    const roto = validarColumnas([{ clave: 'a', nombre: 'A', dias: [0, 1, 2, 3, 4, 5, 6], meses: [], respaldo: 'zzz' }]);
    expect(roto.errores.join(' ')).toMatch(/ya no existe/);
    const hueco = validarColumnas(COLUMNAS_BASE.filter((c) => c.clave !== 'sabado'));
    expect(hueco.errores).toEqual([]);
    expect(hueco.avisos.join(' ')).toMatch(/sábados no caen en ninguna columna/);
  });

  it('describe la regla de un vistazo', () => {
    expect(describirRegla(COLUMNAS_BASE[1]!)).toBe('vie · mar–may, sep, oct');
    expect(describirRegla(COLUMNAS_BASE[3]!)).toBe('dom–jue · todo el año');
  });
});
