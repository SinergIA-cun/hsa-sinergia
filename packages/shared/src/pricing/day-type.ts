import type { DayType } from '../types.js';

const MESES_ESPECIALES = new Set([3, 4, 5, 9, 10]); // marzo-mayo, sep-oct

export function dayType(fechaISO: string): DayType {
  // Interpretar como fecha local sin desfase de zona.
  const [y, m, d] = fechaISO.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const dow = date.getDay(); // 0=dom ... 6=sab
  if (dow === 6) return 'sabado';
  if (dow !== 5) return 'domAJue'; // dom-jue
  return MESES_ESPECIALES.has(m) ? 'viernesEspecial' : 'viernes';
}
