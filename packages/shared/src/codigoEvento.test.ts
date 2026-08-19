import { describe, it, expect } from 'vitest';
import { codigoEvento, CODIGO_MAX_PARTE } from './codigoEvento.js';

describe('codigoEvento', () => {
  it('el formato pedido por el dueño: 17ENE-CBOLADO-CUPULA', () => {
    expect(
      codigoEvento({ fechaISO: '2027-01-17', cliente: 'Carlos Bolado', espacios: ['Jardín La Cúpula'] }),
    ).toBe('17ENE-CBOLADO-CUPULA');
  });

  it('el día conserva sus dos dígitos y el mes es la abreviatura en español', () => {
    const base = { cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] };
    expect(codigoEvento({ ...base, fechaISO: '2027-07-04' })).toBe('04JUL-ARUIZ-ARCOS');
    expect(codigoEvento({ ...base, fechaISO: '2027-12-31' })).toBe('31DIC-ARUIZ-ARCOS');
    expect(codigoEvento({ ...base, fechaISO: '2027-09-01' })).toBe('01SEP-ARUIZ-ARCOS');
  });

  it('acentos y eñes se normalizan: la eñe es N y las tildes se caen', () => {
    // Nombre de dos palabras: inicial de la primera + APELLIDO (la última).
    expect(
      codigoEvento({ fechaISO: '2027-03-13', cliente: 'Muñoz Peña', espacios: ['Jardín La Cúpula'] }),
    ).toBe('13MAR-MPENA-CUPULA');
    // Y la eñe también se normaliza cuando la palabra entra completa.
    expect(
      codigoEvento({ fechaISO: '2027-03-13', cliente: 'Muñoz', espacios: ['Jardín La Cúpula'] }),
    ).toBe('13MAR-MUNOZ-CUPULA');
  });

  it('un nombre de una sola palabra no truena: entra completo', () => {
    expect(
      codigoEvento({ fechaISO: '2027-05-08', cliente: 'Madonna', espacios: ['Salón Los Arcos'] }),
    ).toBe('08MAY-MADONNA-ARCOS');
  });

  it('con tres o más palabras manda la inicial del nombre y el ÚLTIMO apellido', () => {
    expect(
      codigoEvento({ fechaISO: '2027-06-12', cliente: 'María Fernanda Muñoz Peña', espacios: ['Salón Los Arcos'] }),
    ).toBe('12JUN-MPENA-ARCOS');
  });

  it('con varios espacios manda el PRIMERO', () => {
    expect(
      codigoEvento({
        fechaISO: '2027-04-10',
        cliente: 'Carlos Bolado',
        espacios: ['Jardín La Cúpula', 'Salón Los Arcos'],
      }),
    ).toBe('10ABR-CBOLADO-CUPULA');
  });

  it('el espacio ignora artículos y preposiciones: manda la última palabra con contenido', () => {
    const base = { fechaISO: '2027-04-10', cliente: 'Carlos Bolado' };
    expect(codigoEvento({ ...base, espacios: ['Salón Los Arcos'] })).toBe('10ABR-CBOLADO-ARCOS');
    expect(codigoEvento({ ...base, espacios: ['Jardín Los Campos'] })).toBe('10ABR-CBOLADO-CAMPOS');
    expect(codigoEvento({ ...base, espacios: ['Salón Los Balcones'] })).toBe('10ABR-CBOLADO-BALCONES');
    // Un nombre que TERMINA en artículo cae a la palabra anterior en vez de quedarse vacío.
    expect(codigoEvento({ ...base, espacios: ['Jardín La Cúpula de La'] })).toBe('10ABR-CBOLADO-CUPULA');
  });

  it('los nombres largos se truncan al tope, sin cortar el formato', () => {
    const codigo = codigoEvento({
      fechaISO: '2027-08-14',
      cliente: 'Wolfgang Amadeus Villalobos Villaseñor',
      espacios: ['Salón Internacional Extraordinario'],
    });
    const partes = codigo.split('-');
    expect(partes).toHaveLength(3);
    const [dia, cli, esp] = partes as [string, string, string];
    expect(dia).toBe('14AGO');
    expect(cli).toBe('WVILLASENOR'.slice(0, CODIGO_MAX_PARTE));
    expect(esp).toBe('EXTRAORDINARIO'.slice(0, CODIGO_MAX_PARTE));
    expect(cli.length).toBeLessThanOrEqual(CODIGO_MAX_PARTE);
    expect(esp.length).toBeLessThanOrEqual(CODIGO_MAX_PARTE);
  });

  it('caracteres raros, espacios dobles y bordes no ensucian el código', () => {
    expect(
      codigoEvento({
        fechaISO: '2027-10-09',
        cliente: '  josé   *luis*  o’farrill  ',
        espacios: ['  Salón   #Los  Arcos!! '],
      }),
    ).toBe('09OCT-JOFARRILL-ARCOS');
    // Solo A-Z y 0-9 sobreviven: nada de guiones de más que rompan el formato.
    expect(codigoEvento({ fechaISO: '2027-10-09', cliente: 'A-B C-D', espacios: ['X-Y'] })).toBe(
      '09OCT-ACD-XY',
    );
  });

  it('sin cliente o sin espacio el código no se rompe: usa un relleno visible', () => {
    expect(codigoEvento({ fechaISO: '2027-11-13', cliente: '', espacios: [] })).toBe('13NOV-NA-NA');
    expect(codigoEvento({ fechaISO: '2027-11-13', cliente: '***', espacios: ['###'] })).toBe('13NOV-NA-NA');
  });

  it('una fecha que no es YYYY-MM-DD se rechaza en vez de inventar un código', () => {
    expect(() => codigoEvento({ fechaISO: '13/11/2027', cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] })).toThrow();
    expect(() => codigoEvento({ fechaISO: '2027-13-01', cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] })).toThrow();
  });
});
