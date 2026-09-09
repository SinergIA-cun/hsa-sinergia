import { describe, it, expect } from 'vitest';
import {
  agruparPorTransaccion,
  seMuestraSinRuido,
  type RenglonAgrupable,
} from './agrupar.js';

function r(id: string, txid: string, relevancia: 'principal' | 'secundario' = 'principal') {
  return { id, txid, relevancia } satisfies RenglonAgrupable;
}

describe('agrupar la bitácora por transacción', () => {
  it('un acto que escribió tres renglones se ve como un movimiento', () => {
    // Mandar un contrato a la papelera: el UPDATE, su bitácora y la foto.
    const grupos = agruparPorTransaccion([
      r('30', 'tx1', 'secundario'),
      r('29', 'tx1', 'secundario'),
      r('28', 'tx1', 'principal'),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.resto).toHaveLength(2);
  });

  it('el título lo da el renglón principal, no la consecuencia que quedó arriba', () => {
    /*
     * Éste es el punto del agrupador. La bitácora del contrato se escribe
     * DESPUÉS del contrato, así que en una lista de lo más nuevo a lo más viejo
     * queda encima. Si el primer renglón diera el título, el movimiento se
     * anunciaría como "anotó algo en una bitácora" y el hecho real quedaría
     * escondido adentro.
     */
    const grupos = agruparPorTransaccion([
      r('30', 'tx1', 'secundario'),
      r('28', 'tx1', 'principal'),
    ]);
    expect(grupos[0]!.lider.id).toBe('28');
    expect(grupos[0]!.resto.map((f) => f.id)).toEqual(['30']);
  });

  it('sin ningún principal, encabeza el primero: siempre hay algo que mostrar', () => {
    const grupos = agruparPorTransaccion([
      r('30', 'tx1', 'secundario'),
      r('29', 'tx1', 'secundario'),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.lider.id).toBe('30');
  });

  it('transacciones distintas no se mezclan', () => {
    const grupos = agruparPorTransaccion([r('30', 'tx2'), r('29', 'tx1'), r('28', 'tx1')]);
    expect(grupos.map((g) => g.txid)).toEqual(['tx2', 'tx1']);
    expect(grupos.map((g) => g.resto.length)).toEqual([0, 1]);
  });

  it('agrupa por cercanía, así que una txid que reaparece no se junta hacia atrás', () => {
    /*
     * La lista viene ordenada por id, y dentro de una transacción los ids son
     * seguidos: dos transacciones no pueden entreverarse de verdad. Si aun así
     * llegara una txid repetida separada, juntarla afirmaría algo que la página
     * no respalda — así que se dejan como dos movimientos.
     */
    const grupos = agruparPorTransaccion([r('30', 'tx1'), r('29', 'tx2'), r('28', 'tx1')]);
    expect(grupos).toHaveLength(3);
  });

  it('sin transacción conocida, cada renglón va solo', () => {
    // Un txid vacío no es una transacción compartida: es un dato que falta.
    const grupos = agruparPorTransaccion([r('30', ''), r('29', ''), r('28', '')]);
    expect(grupos).toHaveLength(3);
  });

  it('una página vacía no rompe', () => {
    expect(agruparPorTransaccion([])).toEqual([]);
  });
});

describe('esconder el ruido sin esconder la alarma', () => {
  it('las acciones de una persona se muestran', () => {
    expect(seMuestraSinRuido({ relevancia: 'principal', origen: 'persona' })).toBe(true);
  });

  it('lo que la base escribió sola se esconde', () => {
    expect(seMuestraSinRuido({ relevancia: 'secundario', origen: 'sistema' })).toBe(false);
  });

  it('lo que entró por fuera de la app se muestra SIEMPRE, aunque sea consecuencia', () => {
    /*
     * Ésta es la razón de que la regla viva aquí y no en la vista. Alguien que
     * edita la bitácora de un contrato desde una consola de SQL es exactamente
     * lo que esta pantalla existe para delatar: el filtro de comodidad no puede
     * taparlo nunca.
     */
    expect(seMuestraSinRuido({ relevancia: 'secundario', origen: 'externo' })).toBe(true);
  });
});
