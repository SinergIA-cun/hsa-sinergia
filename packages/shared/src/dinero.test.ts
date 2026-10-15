import { describe, it, expect } from 'vitest';
import { centavos, sumarDinero, restarDinero, tieneCentavosValidos, montoSchema } from './dinero.js';

describe('dinero con centavos', () => {
  it('centavos redondea a dos decimales, incluso los casos que la coma flotante rompe', () => {
    expect(centavos(7850.5)).toBe(7850.5);
    expect(centavos(1.005)).toBe(1.01);
    expect(centavos(0.1 + 0.2)).toBe(0.3);
    expect(centavos(-0.001)).toBe(0);
    expect(Object.is(centavos(-0.001), -0)).toBe(false);
  });

  it('sumar y restar en centavos enteros: el saldo que debe dar cero da cero', () => {
    expect(sumarDinero(0.1, 0.2)).toBe(0.3);
    expect(sumarDinero(100.1, 200.2)).toBe(300.3);
    expect(restarDinero(300.3, sumarDinero(100.1, 200.2))).toBe(0);
    expect(restarDinero(7850.5, 7850)).toBe(0.5);
    expect(sumarDinero()).toBe(0);
  });

  it('valida montos con a lo más dos decimales', () => {
    expect(tieneCentavosValidos(7850.5)).toBe(true);
    expect(tieneCentavosValidos(7850.55)).toBe(true);
    expect(tieneCentavosValidos(0.07)).toBe(true);
    expect(tieneCentavosValidos(7850.555)).toBe(false);
    expect(montoSchema.safeParse(7850.5).success).toBe(true);
    expect(montoSchema.safeParse(0).success).toBe(false);
    expect(montoSchema.safeParse(1.234).success).toBe(false);
  });
});

describe('pesosTexto', () => {
  it('sin decimales si es entero; con dos si trae centavos', async () => {
    const { pesosTexto } = await import('./dinero.js');
    expect(pesosTexto(7850)).toBe('$7,850');
    expect(pesosTexto(7850.5)).toBe('$7,850.50');
    expect(pesosTexto(0.1 + 0.2)).toBe('$0.30');
  });
});
