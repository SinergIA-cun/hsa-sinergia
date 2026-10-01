import { describe, it, expect } from 'vitest';
import { tieneContacto, telefonoValido, correoValido } from './contacto.js';

describe('contacto del cliente', () => {
  it('basta con el teléfono', () => {
    expect(tieneContacto({ telefono: '55 1234 5678' })).toBe(true);
  });

  it('basta con el correo', () => {
    expect(tieneContacto({ correo: 'ana@ejemplo.com' })).toBe(true);
  });

  it('sin ninguno de los dos no cuenta', () => {
    expect(tieneContacto({})).toBe(false);
    expect(tieneContacto({ telefono: '', correo: '' })).toBe(false);
    expect(tieneContacto({ telefono: null, correo: null })).toBe(false);
  });

  it('un teléfono de relleno no cuenta', () => {
    expect(telefonoValido('x')).toBe(false);
    expect(telefonoValido('123')).toBe(false);
    expect(telefonoValido('+52 (55) 1234-5678')).toBe(true);
  });

  it('un correo sin dominio no cuenta', () => {
    expect(correoValido('ana')).toBe(false);
    expect(correoValido('ana@ejemplo')).toBe(false);
    expect(correoValido(' ana@ejemplo.mx ')).toBe(true);
  });
});
