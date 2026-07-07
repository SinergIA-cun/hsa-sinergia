import { describe, it, expect } from 'vitest';
import { dayType } from './day-type.js';

describe('dayType', () => {
  it('sábado => sabado', () => {
    expect(dayType('2027-05-08')).toBe('sabado'); // sábado
  });
  it('domingo a jueves => domAJue', () => {
    expect(dayType('2027-05-09')).toBe('domAJue'); // domingo
    expect(dayType('2027-05-13')).toBe('domAJue'); // jueves
  });
  it('viernes normal => viernes', () => {
    expect(dayType('2027-01-08')).toBe('viernes'); // viernes enero
  });
  it('viernes de temporada especial (mar-may, sep-oct) => viernesEspecial', () => {
    expect(dayType('2027-05-07')).toBe('viernesEspecial'); // viernes mayo
    expect(dayType('2027-09-03')).toBe('viernesEspecial'); // viernes septiembre
  });
});
