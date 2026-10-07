import type { Marca } from '@hsa/shared';

// Los tres correos al cliente (decisión del dueño, 6-oct-2026). Son funciones
// puras: reciben los datos ya armados y devuelven asunto, HTML y texto plano.
// El cliente NO recibe enlace a su portal: todo lo que necesita va en el correo.

export interface EventoCorreo {
  cliente: string;
  codigo: string | null;
  tipoEvento: string | null;
  /** YYYY-MM-DD */
  fecha: string;
  salones: string[];
  invitados: number;
  /** Lo que se le paga a la hacienda (la renta, con lo que sube el contrato). */
  renta: number;
  pagado: number;
  saldo: number;
  plan: { label: string; objetivo: number; completo: boolean; venceISO: string | null }[] | null;
}

export interface PagoCorreo {
  folio: string;
  monto: number;
  /** YYYY-MM-DD */
  fecha: string;
  concepto: string;
  formas: { forma: string; monto: number }[];
}

export interface CierreCorreo {
  /** El valor del contrato (renta + alimentos y servicios). */
  contrato: number;
  /** Lo que se agregó en el punto de venta: horas extra, PAX, DJ, multas… */
  extras: { nombre: string; cantidad: number; total: number }[];
}

export interface Correo {
  subject: string;
  html: string;
  text: string;
}

const COLOR = { tinta: '#14304d', oro: '#b0894e', crema: '#f7f2e8', gris: '#6b6b6b', linea: '#e6dfd2' };

const pesos = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);

/** "sábado 14 de noviembre de 2026" */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renglones(filas: [string, string][]): string {
  return filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:${COLOR.gris};font-size:14px">${esc(k)}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:14px;color:${COLOR.tinta}">${esc(v)}</td></tr>`,
    )
    .join('');
}

function tabla(filas: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${COLOR.linea};border-bottom:1px solid ${COLOR.linea};margin:16px 0">${renglones(filas)}</table>`;
}

function parrafo(t: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#2a2a2a">${t}</p>`;
}

function layout(marca: Marca, titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:${COLOR.crema};font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.crema};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${COLOR.tinta};padding:22px 28px;text-align:center;color:${COLOR.crema};font-size:22px;letter-spacing:.02em">${esc(marca.nombre)}
<div style="font-size:10px;letter-spacing:.35em;color:${COLOR.oro};margin-top:4px">${esc(marca.anio)}</div></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 18px;font-size:22px;font-weight:normal;color:${COLOR.tinta}">${esc(titulo)}</h1>
${cuerpo}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${COLOR.linea};font-size:12px;line-height:1.5;color:${COLOR.gris};text-align:center">
${esc(marca.razonSocial)}<br>${esc(marca.direccion)}<br>Tel. ${esc(marca.telefono)} · ${esc(marca.sitio)}</td></tr>
</table></td></tr></table></body></html>`;
}

function datosEvento(e: EventoCorreo): [string, string][] {
  return [
    ['Evento', [e.tipoEvento, fechaLarga(e.fecha)].filter(Boolean).join(' · ')],
    ...(e.salones.length ? ([['Espacio', e.salones.join(', ')]] as [string, string][]) : []),
    ['Invitados', String(e.invitados)],
    ...(e.codigo ? ([['Código del evento', e.codigo]] as [string, string][]) : []),
  ];
}

function filasPago(p: PagoCorreo): [string, string][] {
  return [
    ['Folio', p.folio],
    ['Concepto', p.concepto],
    ['Fecha del pago', fechaLarga(p.fecha)],
    ...p.formas.map((f, i): [string, string] => [i === 0 ? 'Forma de pago' : '', p.formas.length > 1 ? `${f.forma} · ${pesos(f.monto)}` : f.forma]),
    ['Monto', pesos(p.monto)],
  ];
}

function planHtml(e: EventoCorreo): string {
  if (!e.plan?.length) return '';
  const filas = e.plan.map((m): [string, string] => [
    m.venceISO ? `${m.label} (a más tardar el ${fechaLarga(m.venceISO)})` : m.label,
    m.completo ? `${pesos(m.objetivo)} · cubierto` : pesos(m.objetivo),
  ]);
  return `<p style="margin:18px 0 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${COLOR.oro}">Plan de pagos de la renta</p>${tabla(filas)}`;
}

function textoPlano(lineas: (string | null | false)[]): string {
  return lineas.filter((l): l is string => typeof l === 'string').join('\n');
}

/** Al formalizar: su fecha quedó confirmada. Lleva el recibo del pago que la confirmó, si lo hubo. */
export function correoBienvenida(marca: Marca, e: EventoCorreo, pago: PagoCorreo | null): Correo {
  const cuerpo =
    parrafo(`Hola ${esc(e.cliente)}:`) +
    parrafo(`¡Gracias por elegirnos! Su evento en ${esc(marca.nombre)} quedó <strong>confirmado</strong>. Estos son sus datos:`) +
    tabla(datosEvento(e)) +
    tabla([
      ['Renta del evento', pesos(e.renta)],
      ['Pagado', pesos(e.pagado)],
      ['Saldo', pesos(e.saldo)],
    ]) +
    planHtml(e) +
    (pago ? parrafo(`Adjuntamos el recibo de su pago <strong>${esc(pago.folio)}</strong> por ${pesos(pago.monto)}.`) : '') +
    parrafo('Cada pago que haga le llegará a este correo con su recibo. Guárdelos: son su comprobante.') +
    parrafo(`Para cualquier duda, llámenos al ${esc(marca.telefono)} o responda este correo.`);
  return {
    subject: `Su evento está confirmado · ${marca.nombre}`,
    html: layout(marca, 'Su evento está confirmado', cuerpo),
    text: textoPlano([
      `Hola ${e.cliente}:`,
      '',
      `¡Gracias por elegirnos! Su evento en ${marca.nombre} quedó confirmado.`,
      '',
      ...datosEvento(e).map(([k, v]) => `${k}: ${v}`),
      `Renta del evento: ${pesos(e.renta)}`,
      `Pagado: ${pesos(e.pagado)}`,
      `Saldo: ${pesos(e.saldo)}`,
      ...(e.plan ?? []).map((m) => `${m.label}: ${pesos(m.objetivo)}${m.venceISO ? ` a más tardar el ${fechaLarga(m.venceISO)}` : ''}${m.completo ? ' (cubierto)' : ''}`),
      pago && `\nAdjuntamos el recibo de su pago ${pago.folio} por ${pesos(pago.monto)}.`,
      '',
      'Cada pago que haga le llegará a este correo con su recibo.',
      `Dudas: ${marca.telefono}.`,
    ]),
  };
}

/** Por cada pago: el recibo en PDF y cómo va su cuenta. */
export function correoRecibo(marca: Marca, e: EventoCorreo, pago: PagoCorreo, esDeCargos: boolean): Correo {
  const cuenta: [string, string][] = esDeCargos
    ? []
    : [
        ['Renta del evento', pesos(e.renta)],
        ['Pagado a la fecha', pesos(e.pagado)],
        ['Saldo', pesos(e.saldo)],
      ];
  const cuerpo =
    parrafo(`Hola ${esc(e.cliente)}:`) +
    parrafo(`Recibimos su pago. Adjuntamos su recibo <strong>${esc(pago.folio)}</strong> en PDF.`) +
    tabla(filasPago(pago)) +
    (cuenta.length ? tabla(cuenta) : '') +
    tabla(datosEvento(e)) +
    parrafo(`Gracias. Para cualquier duda, llámenos al ${esc(marca.telefono)} o responda este correo.`);
  return {
    subject: `Recibo ${pago.folio} · ${marca.nombre}`,
    html: layout(marca, 'Recibimos su pago', cuerpo),
    text: textoPlano([
      `Hola ${e.cliente}:`,
      '',
      `Recibimos su pago. Adjuntamos su recibo ${pago.folio}.`,
      '',
      ...filasPago(pago).filter(([k]) => k).map(([k, v]) => `${k}: ${v}`),
      ...cuenta.map(([k, v]) => `${k}: ${v}`),
      '',
      ...datosEvento(e).map(([k, v]) => `${k}: ${v}`),
    ]),
  };
}

/** A los 2 días hábiles: gracias, el total del evento con sus extras y una invitación a recomendarnos. */
export function correoCierre(marca: Marca, e: EventoCorreo, c: CierreCorreo): Correo {
  const extrasTotal = c.extras.reduce((s, x) => s + x.total, 0);
  const filasExtras = c.extras.map((x): [string, string] => [x.cantidad > 1 ? `${x.nombre} (${x.cantidad})` : x.nombre, pesos(x.total)]);
  const totalEvento = c.contrato + extrasTotal;
  const cuerpo =
    parrafo(`Hola ${esc(e.cliente)}:`) +
    parrafo(`Gracias por celebrar con nosotros su ${esc((e.tipoEvento ?? 'evento').toLowerCase())} del ${fechaLarga(e.fecha)}. Fue un gusto recibirlos.`) +
    tabla([['Contrato', pesos(c.contrato)]]) +
    (filasExtras.length
      ? `<p style="margin:18px 0 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${COLOR.oro}">Extras del evento</p>${tabla(filasExtras)}`
      : '') +
    tabla([['Total del evento', pesos(totalEvento)]]) +
    parrafo(
      `Si conoce a alguien que esté planeando una boda, unos XV años o cualquier celebración, nos encantaría atenderle: recomiéndenos con ${esc(marca.telefono)} · ${esc(marca.sitio)}.`,
    ) +
    parrafo('¡Gracias de nuevo!');
  return {
    subject: `Gracias por celebrar con nosotros · ${marca.nombre}`,
    html: layout(marca, 'Gracias por celebrar con nosotros', cuerpo),
    text: textoPlano([
      `Hola ${e.cliente}:`,
      '',
      `Gracias por celebrar con nosotros su ${(e.tipoEvento ?? 'evento').toLowerCase()} del ${fechaLarga(e.fecha)}.`,
      '',
      `Contrato: ${pesos(c.contrato)}`,
      ...filasExtras.map(([k, v]) => `${k}: ${v}`),
      `Total del evento: ${pesos(totalEvento)}`,
      '',
      `¿Conoce a alguien que esté planeando un evento? Recomiéndenos: ${marca.telefono} · ${marca.sitio}.`,
    ]),
  };
}
