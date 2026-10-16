import { describe, it, expect } from 'vitest';
import { PLANTILLAS_WHATSAPP, rellenarPlantilla } from './whatsapp.js';

describe('plantillas de WhatsApp', () => {
  it('rellena las variables y deja vacías las que faltan sin espacios dobles', () => {
    expect(rellenarPlantilla('Hola {cliente}, su saldo es {saldo} .', { cliente: 'Ana' })).toBe('Hola Ana, su saldo es.');
    expect(rellenarPlantilla(PLANTILLAS_WHATSAPP.saludo.texto, { cliente: 'Ana', marca: 'HSA', evento: 'boda', fecha: '5 dic 2026' })).toBe(
      'Hola Ana, le escribimos de HSA sobre su boda del 5 dic 2026.',
    );
  });
});
