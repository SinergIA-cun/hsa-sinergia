import { describe, it, expect } from 'vitest';
import { ordenarEspacios, prioridadEspacio } from './orden.js';

describe('orden de los salones', () => {
  it('Cúpula, Arcos, Campos y luego Balcones y Pajaritos, sin importar cómo lleguen', () => {
    const r = ordenarEspacios([{ nombre: 'Pajaritos' }, { nombre: 'Arcos' }, { nombre: 'Balcones' }, { nombre: 'Campos' }, { nombre: 'Cúpula' }]);
    expect(r.map((e) => e.nombre)).toEqual(['Cúpula', 'Arcos', 'Campos', 'Balcones', 'Pajaritos']);
  });
  it('reconoce los nombres viejos y sin acento; un salón nuevo va al final', () => {
    expect(prioridadEspacio('Jardín La Cúpula')).toBe(0);
    expect(prioridadEspacio('CUPULA')).toBe(0);
    expect(prioridadEspacio('Terraza')).toBe(5);
  });
});
