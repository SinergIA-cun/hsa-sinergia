import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Marca } from '@hsa/shared';
import { fechaLarga, type EventoCorreo, type PagoCorreo } from './plantillas.js';

const TINTA = rgb(0.078, 0.188, 0.302);
const ORO = rgb(0.69, 0.537, 0.306);
const GRIS = rgb(0.45, 0.45, 0.45);

const pesos = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);

/**
 * El recibo de un pago en PDF, el mismo que se imprime desde el punto de venta:
 * folio, monto, concepto, forma de pago, fecha, cliente y evento. Media carta.
 *
 * Las fuentes estándar del PDF (WinAnsi) cubren acentos y ñ; un carácter fuera
 * de ellas se cambia por "?" en vez de tronar el correo.
 */
export async function reciboPdf(
  marca: Marca,
  e: EventoCorreo & { referencia: number | null },
  p: PagoCorreo,
  emitido: Date,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${p.folio}`);
  doc.setAuthor(marca.nombre);
  const page = doc.addPage([396, 612]); // media carta
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const W = page.getWidth();
  const limpio = (s: string) => s.replace(/[^ -ÿ]/g, '?');

  const centro = (texto: string, y: number, size: number, font = serif, color = TINTA) => {
    const t = limpio(texto);
    page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };

  let y = 560;
  centro(marca.nombre, y, 18);
  y -= 14;
  centro(marca.anio.split('').join(' '), y, 7, sans, ORO);
  y -= 40;
  centro('Recibo de pago', y, 20);
  y -= 20;
  centro(`Folio ${p.folio}`, y, 11, sans, ORO);
  y -= 48;
  centro(pesos(p.monto), y, 28);
  y -= 30;

  page.drawLine({ start: { x: 36, y }, end: { x: W - 36, y }, thickness: 0.5, color: GRIS });
  y -= 20;
  const filas: [string, string][] = [
    ['Concepto', p.concepto],
    ...p.formas.map((f, i): [string, string] => [i === 0 ? 'Forma de pago' : '', p.formas.length > 1 ? `${f.forma} · ${pesos(f.monto)}` : f.forma]),
    ['Fecha del pago', fechaLarga(p.fecha)],
    ['Cliente', e.cliente],
    ...(e.referencia != null ? ([['N.º de referencia', String(e.referencia)]] as [string, string][]) : []),
    ['Evento', [e.tipoEvento, fechaLarga(e.fecha)].filter(Boolean).join(' · ')],
    ...(e.codigo ? ([['Código del evento', e.codigo]] as [string, string][]) : []),
  ];
  for (const [k, v] of filas) {
    page.drawText(limpio(k), { x: 36, y, size: 9, font: sans, color: GRIS });
    const t = limpio(v);
    const size = sans.widthOfTextAtSize(t, 9) > W - 150 ? 7.5 : 9;
    page.drawText(t, { x: W - 36 - sans.widthOfTextAtSize(t, size), y, size, font: sans, color: TINTA });
    y -= 18;
  }
  y -= 4;
  page.drawLine({ start: { x: 36, y }, end: { x: W - 36, y }, thickness: 0.5, color: GRIS });

  const pie = [`Emitido el ${fechaLarga(emitido.toISOString().slice(0, 10))} · ${marca.razonSocial}`, marca.direccion];
  pie.forEach((linea, i) => {
    const t = limpio(linea);
    const size = sans.widthOfTextAtSize(t, 7) > W - 40 ? 6 : 7;
    page.drawText(t, { x: (W - sans.widthOfTextAtSize(t, size)) / 2, y: 50 - i * 11, size, font: sans, color: GRIS });
  });

  return Buffer.from(await doc.save());
}
