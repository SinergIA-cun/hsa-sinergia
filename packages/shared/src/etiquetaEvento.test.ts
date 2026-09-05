import { describe, it, expect } from 'vitest';
import { etiquetaEvento, ETIQUETA_MAX_PARTE } from './etiquetaEvento.js';

describe('etiquetaEvento', () => {
  it('el formato pedido por el dueño: 17ENE27-CBOLADO-CUPULA', () => {
    expect(
      etiquetaEvento({ fechaISO: '2027-01-17', cliente: 'Carlos Bolado', espacios: ['Jardín La Cúpula'] }),
    ).toBe('17ENE27-CBOLADO-CUPULA');
  });

  it('el año distingue: el mismo día y salón de dos años distintos NO se empalman', () => {
    // La razón de ser del año en el código: sin él, `29OCT-CBARRERA-CUPULA` era
    // el código de 2027, de 2028 y de 2029, y el sufijo `-2` no dice de cuál.
    const base = { cliente: 'Carlos Barrera', espacios: ['Jardín La Cúpula'] };
    expect(etiquetaEvento({ ...base, fechaISO: '2027-10-29' })).toBe('29OCT27-CBARRERA-CUPULA');
    expect(etiquetaEvento({ ...base, fechaISO: '2028-10-29' })).toBe('29OCT28-CBARRERA-CUPULA');
    expect(etiquetaEvento({ ...base, fechaISO: '2029-10-29' })).toBe('29OCT29-CBARRERA-CUPULA');
  });

  it('el año son los DOS últimos dígitos, con su cero al frente', () => {
    const base = { cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] };
    expect(etiquetaEvento({ ...base, fechaISO: '2030-05-08' })).toBe('08MAY30-ARUIZ-ARCOS');
    expect(etiquetaEvento({ ...base, fechaISO: '2100-05-08' })).toBe('08MAY00-ARUIZ-ARCOS');
  });

  it('el día conserva sus dos dígitos y el mes es la abreviatura en español', () => {
    const base = { cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] };
    expect(etiquetaEvento({ ...base, fechaISO: '2027-07-04' })).toBe('04JUL27-ARUIZ-ARCOS');
    expect(etiquetaEvento({ ...base, fechaISO: '2027-12-31' })).toBe('31DIC27-ARUIZ-ARCOS');
    expect(etiquetaEvento({ ...base, fechaISO: '2027-09-01' })).toBe('01SEP27-ARUIZ-ARCOS');
  });

  it('acentos y eñes se normalizan: la eñe es N y las tildes se caen', () => {
    // Nombre de dos palabras: inicial de la primera + APELLIDO (la última).
    expect(
      etiquetaEvento({ fechaISO: '2027-03-13', cliente: 'Muñoz Peña', espacios: ['Jardín La Cúpula'] }),
    ).toBe('13MAR27-MPENA-CUPULA');
    // Y la eñe también se normaliza cuando la palabra entra completa.
    expect(
      etiquetaEvento({ fechaISO: '2027-03-13', cliente: 'Muñoz', espacios: ['Jardín La Cúpula'] }),
    ).toBe('13MAR27-MUNOZ-CUPULA');
  });

  it('un nombre de una sola palabra no truena: entra completo', () => {
    expect(
      etiquetaEvento({ fechaISO: '2027-05-08', cliente: 'Madonna', espacios: ['Salón Los Arcos'] }),
    ).toBe('08MAY27-MADONNA-ARCOS');
  });

  it('con tres o más palabras manda la inicial del nombre y el ÚLTIMO apellido', () => {
    expect(
      etiquetaEvento({ fechaISO: '2027-06-12', cliente: 'María Fernanda Muñoz Peña', espacios: ['Salón Los Arcos'] }),
    ).toBe('12JUN27-MPENA-ARCOS');
  });

  it('con varios espacios manda el PRIMERO', () => {
    expect(
      etiquetaEvento({
        fechaISO: '2027-04-10',
        cliente: 'Carlos Bolado',
        espacios: ['Jardín La Cúpula', 'Salón Los Arcos'],
      }),
    ).toBe('10ABR27-CBOLADO-CUPULA');
  });

  it('el espacio ignora artículos y preposiciones: manda la última palabra con contenido', () => {
    const base = { fechaISO: '2027-04-10', cliente: 'Carlos Bolado' };
    expect(etiquetaEvento({ ...base, espacios: ['Salón Los Arcos'] })).toBe('10ABR27-CBOLADO-ARCOS');
    expect(etiquetaEvento({ ...base, espacios: ['Jardín Los Campos'] })).toBe('10ABR27-CBOLADO-CAMPOS');
    expect(etiquetaEvento({ ...base, espacios: ['Salón Los Balcones'] })).toBe('10ABR27-CBOLADO-BALCONES');
    // Un nombre que TERMINA en artículo cae a la palabra anterior en vez de quedarse vacío.
    expect(etiquetaEvento({ ...base, espacios: ['Jardín La Cúpula de La'] })).toBe('10ABR27-CBOLADO-CUPULA');
  });

  it('los nombres largos se truncan al tope, sin cortar el formato', () => {
    const etiqueta = etiquetaEvento({
      fechaISO: '2027-08-14',
      cliente: 'Wolfgang Amadeus Villalobos Villaseñor',
      espacios: ['Salón Internacional Extraordinario'],
    });
    const partes = etiqueta.split('-');
    expect(partes).toHaveLength(3);
    const [dia, cli, esp] = partes as [string, string, string];
    expect(dia).toBe('14AGO27');
    expect(cli).toBe('WVILLASENOR'.slice(0, ETIQUETA_MAX_PARTE));
    expect(esp).toBe('EXTRAORDINARIO'.slice(0, ETIQUETA_MAX_PARTE));
    expect(cli.length).toBeLessThanOrEqual(ETIQUETA_MAX_PARTE);
    expect(esp.length).toBeLessThanOrEqual(ETIQUETA_MAX_PARTE);
  });

  it('caracteres raros, espacios dobles y bordes no ensucian el código', () => {
    expect(
      etiquetaEvento({
        fechaISO: '2027-10-09',
        cliente: '  josé   *luis*  o’farrill  ',
        espacios: ['  Salón   #Los  Arcos!! '],
      }),
    ).toBe('09OCT27-JOFARRILL-ARCOS');
    // Solo A-Z y 0-9 sobreviven: nada de guiones de más que rompan el formato.
    expect(etiquetaEvento({ fechaISO: '2027-10-09', cliente: 'A-B C-D', espacios: ['X-Y'] })).toBe(
      '09OCT27-ACD-XY',
    );
  });

  it('sin cliente o sin espacio el código no se rompe: usa un relleno visible', () => {
    expect(etiquetaEvento({ fechaISO: '2027-11-13', cliente: '', espacios: [] })).toBe('13NOV27-NA-NA');
    expect(etiquetaEvento({ fechaISO: '2027-11-13', cliente: '***', espacios: ['###'] })).toBe('13NOV27-NA-NA');
  });

  it('una fecha que no es YYYY-MM-DD se rechaza en vez de inventar un código', () => {
    expect(() => etiquetaEvento({ fechaISO: '13/11/2027', cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] })).toThrow();
    expect(() => etiquetaEvento({ fechaISO: '2027-13-01', cliente: 'Ana Ruiz', espacios: ['Salón Los Arcos'] })).toThrow();
  });
});
