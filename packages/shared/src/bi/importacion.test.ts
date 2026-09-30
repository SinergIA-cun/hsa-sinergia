import { describe, it, expect } from 'vitest';
import { normalizarNombre, emparejarNombre, desgloseImportado, compararEvento } from './importacion.js';

describe('normalizarNombre y emparejarNombre', () => {
  const salones = [
    { nombre: 'Jardín La Cúpula' },
    { nombre: 'Salón Los Arcos' },
    { nombre: 'Jardín Los Campos' },
  ];
  it('"Cúpula", "LA CUPULA" y "Jardín La Cúpula" son el mismo salón', () => {
    expect(normalizarNombre('Jardín La Cúpula')).toBe('cupula');
    expect(emparejarNombre('LA CUPULA', salones)?.nombre).toBe('Jardín La Cúpula');
    expect(emparejarNombre('arcos', salones)?.nombre).toBe('Salón Los Arcos');
  });
  it('lo que no coincide no se adivina', () => {
    expect(emparejarNombre('Terraza', salones)).toBeNull();
    expect(emparejarNombre('', salones)).toBeNull();
  });
  it('dos coincidencias no son una: se reporta en vez de elegir', () => {
    expect(emparejarNombre('Boda', [{ nombre: 'Boda' }, { nombre: 'BODA' }])).toBeNull();
  });
  it('también empareja por slug', () => {
    expect(emparejarNombre('xv', [{ nombre: 'XV Años', slug: 'xv' }])?.nombre).toBe('XV Años');
  });
});

describe('desgloseImportado', () => {
  it('conserva el precio pactado y lo reparte por salón con su spaceId', () => {
    const b = desgloseImportado({
      salones: [
        { spaceId: 'a', nombre: 'Arcos' },
        { spaceId: 'b', nombre: 'Campos' },
      ],
      rentaTotal: 100_001,
      otrosTotal: 50_000,
      ivaRate: 0.16,
    });
    expect(b.lines.filter((l) => l.grupo === 'renta').map((l) => [l.spaceId, l.monto])).toEqual([
      ['a', 50_000],
      ['b', 50_001],
    ]);
    expect(b.rentaTotal).toBe(100_001);
    expect(b.total).toBe(150_001);
    expect(b.rentaSubtotal + b.rentaIva).toBeCloseTo(100_001, 2);
  });
  it('sin alimentos no inventa un renglón en cero', () => {
    const b = desgloseImportado({ salones: [{ spaceId: 'a', nombre: 'Arcos' }], rentaTotal: 1000, otrosTotal: 0, ivaRate: 0.16 });
    expect(b.lines).toHaveLength(1);
  });
});

describe('compararEvento', () => {
  const base = {
    fechaEvento: '2027-01-01',
    spaceIds: ['a'],
    invitados: 200,
    eventTypeId: 'boda',
    rentaTotal: 100_000,
    pagado: 30_000,
    folios: [5001, 5002],
  };
  it('igual → sin diferencias', () => {
    expect(compararEvento(base, { ...base, spaceIds: ['a'] })).toEqual([]);
  });
  it('reporta cada campo que no cuadra', () => {
    const d = compararEvento(base, { ...base, invitados: 220, rentaTotal: 90_000, folios: [5001, 5400] });
    expect(d.map((x) => x.campo)).toEqual(['invitados', 'rentaTotal', 'folios']);
    expect(d.find((x) => x.campo === 'folios')).toEqual({ campo: 'folios', bi: [5002], hsa: [5400] });
  });
  it('lo pagado también se compara', () => {
    expect(compararEvento(base, { ...base, pagado: 40_000 }).map((x) => x.campo)).toEqual(['pagado']);
  });
});
