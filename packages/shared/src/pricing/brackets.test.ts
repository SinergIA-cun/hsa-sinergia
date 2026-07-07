import { describe, it, expect } from 'vitest';
import { findBracket } from './brackets.js';
import type { CapacityBracket } from '../types.js';

const rows: (CapacityBracket & { v: number })[] = [
  { min: 1, max: 50, v: 42000 },
  { min: 51, max: 100, v: 76000 },
  { min: 201, max: 300, v: 108500 },
];

describe('findBracket', () => {
  it('encuentra el rango que contiene el número de invitados', () => {
    expect(findBracket(rows, 30)?.v).toBe(42000);
    expect(findBracket(rows, 100)?.v).toBe(76000);
    expect(findBracket(rows, 250)?.v).toBe(108500);
  });
  it('devuelve undefined si ningún rango aplica', () => {
    expect(findBracket(rows, 500)).toBeUndefined();
  });
  it('respeta max=null como sin tope', () => {
    expect(findBracket([{ min: 301, max: null, v: 679 }], 800)?.v).toBe(679);
  });
});
