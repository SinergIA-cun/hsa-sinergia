import { describe, it, expect } from 'vitest';
import {
  descansosObligatorios,
  esDiaHabil,
  sumarDiasHabiles,
  vigenciaDeApartado,
  DIAS_HABILES_APARTADO,
} from './vigencia.js';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const venceEl = (iso: string) => vigenciaDeApartado(d(iso)).toISOString().slice(0, 10);

describe('la vigencia de una fecha apartada', () => {
  it('el ejemplo del dueño: apartas un viernes y vence el martes', () => {
    /*
     * "Si hoy viernes apartamos tu fecha, te quedan los 5 días de la siguiente
     * semana y 2 de la que viene después de esa: el martes vencería."
     *
     * Viernes 9 de octubre de 2026. Sin ningún festivo de por medio, así que se
     * ve el conteo limpio: lun a vie (5) y lun, mar (7).
     */
    expect(venceEl('2026-10-09')).toBe('2026-10-20');
  });

  it('un festivo de por medio corre el vencimiento, no lo consume', () => {
    /*
     * Viernes 11 de septiembre de 2026. El miércoles 16 es la Independencia, así
     * que ese día no cuenta y el plazo termina el miércoles 23 en vez del martes
     * 22. Es la diferencia entre "siete días" y "siete días HÁBILES".
     */
    expect(venceEl('2026-09-11')).toBe('2026-09-23');
  });

  it('un apartado de mediados de diciembre no muere en Navidad', () => {
    // El 25 no cuenta, así que el plazo salta al otro lado de la fiesta.
    expect(venceEl('2026-12-18')).toBe('2026-12-30');
  });

  it('el día en que se aparta no cuenta, aunque sea hábil', () => {
    /*
     * Quien aparta un viernes a las seis de la tarde no tuvo ese viernes. Se
     * cuenta desde el día siguiente: por eso un lunes + 1 día hábil es martes.
     */
    expect(sumarDiasHabiles(d('2026-10-05'), 1).toISOString().slice(0, 10)).toBe('2026-10-06');
  });

  it('apartar en sábado arranca el conteo el lunes', () => {
    // Sábado 10 de octubre: el primer día hábil es el lunes 12.
    expect(sumarDiasHabiles(d('2026-10-10'), 1).toISOString().slice(0, 10)).toBe('2026-10-12');
  });

  it('el plazo son siete días hábiles', () => {
    expect(DIAS_HABILES_APARTADO).toBe(7);
    expect(vigenciaDeApartado(d('2026-10-09'))).toEqual(sumarDiasHabiles(d('2026-10-09'), 7));
  });
});

describe('los descansos obligatorios de la ley', () => {
  it('los tres que se recorren al lunes se calculan, no se adivinan', () => {
    /*
     * Desde la reforma de 2006, el 5 de febrero se descansa el PRIMER LUNES de
     * febrero, no el 5. En 2027 el 5 cae viernes y el descanso es el lunes 1: una
     * tabla de fechas fijas se equivocaría los dos días.
     */
    expect(esDiaHabil(d('2027-02-05'))).toBe(true);
    expect(esDiaHabil(d('2027-02-01'))).toBe(false);
    // Tercer lunes de marzo (Juárez) y de noviembre (Revolución), en 2026.
    expect(esDiaHabil(d('2026-03-16'))).toBe(false);
    expect(esDiaHabil(d('2026-11-16'))).toBe(false);
  });

  it('las fechas fijas del año', () => {
    for (const fijo of ['2026-01-01', '2026-05-01', '2026-09-16', '2026-12-25']) {
      expect(esDiaHabil(d(fijo))).toBe(false);
    }
  });

  it('la transmisión del Poder Ejecutivo solo cae cada seis años', () => {
    // 2024 sí, y de ahí cada seis. Los años de en medio se trabaja el 1 de octubre.
    expect(descansosObligatorios(2024).has(d('2024-10-01').getTime())).toBe(true);
    expect(descansosObligatorios(2030).has(d('2030-10-01').getTime())).toBe(true);
    expect(descansosObligatorios(2026).has(d('2026-10-01').getTime())).toBe(false);
  });

  it('los que la gente siente festivos pero la ley no da: se trabajan', () => {
    /*
     * El 2 de noviembre, el 12 de diciembre y el Viernes Santo NO son descanso
     * obligatorio del artículo 74. Contarlos alargaría cada plazo sin que ninguna
     * ley lo pida.
     */
    expect(esDiaHabil(d('2026-11-02'))).toBe(true);
    for (const anio of [2026, 2027]) {
      expect(descansosObligatorios(anio).has(d(`${anio}-12-12`).getTime())).toBe(false);
    }
  });

  it('un sábado o un domingo nunca son hábiles', () => {
    expect(esDiaHabil(d('2026-10-10'))).toBe(false);
    expect(esDiaHabil(d('2026-10-11'))).toBe(false);
  });
});
