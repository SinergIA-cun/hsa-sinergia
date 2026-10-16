/**
 * Mensajes de WhatsApp por etapa (reunión del 15-oct-2026). La API oficial se
 * descartó por costo: el sistema PRE-REDACTA y la persona lo manda desde su
 * WhatsApp. Los textos los edita el admin (Admin → Mensajes de WhatsApp); estos
 * son los de arranque, para que Nora los ajuste.
 *
 * Variables entre llaves: {cliente}, {evento}, {fecha}, {salon}, {codigo},
 * {total}, {pagado}, {saldo}, {enlaceRecibo}, {marca}. Una que no aplica en ese
 * momento se queda vacía.
 */
export const ETAPAS_WHATSAPP = ['saludo', 'confirmacion', 'recordatorioSaldo', 'ultimoRecibo', 'agradecimiento', 'apartadoSeguimiento'] as const;
export type EtapaWhatsapp = (typeof ETAPAS_WHATSAPP)[number];

export const PLANTILLAS_WHATSAPP: Record<EtapaWhatsapp, { titulo: string; texto: string }> = {
  saludo: {
    titulo: 'Saludo',
    texto: 'Hola {cliente}, le escribimos de {marca} sobre su {evento} del {fecha}.',
  },
  confirmacion: {
    titulo: 'Confirmación del evento',
    texto: 'Hola {cliente}, ¡gracias! Confirmamos su evento en {marca}: {evento} el {fecha} en {salon}. Su código es {codigo}. Cualquier duda estamos para servirle.',
  },
  recordatorioSaldo: {
    titulo: 'Recordatorio de saldo',
    texto: 'Hola {cliente}, le recordamos que su {evento} del {fecha} tiene un saldo pendiente de {saldo} (lleva pagado {pagado} de {total}). Quedamos atentos para ayudarle con el pago.',
  },
  ultimoRecibo: {
    titulo: 'Último recibo',
    texto: 'Hola {cliente}, le compartimos su recibo de {marca}: {enlaceRecibo}',
  },
  agradecimiento: {
    titulo: 'Agradecimiento',
    texto: 'Hola {cliente}, gracias por celebrar su {evento} con nosotros en {marca}. Fue un gusto recibirlos. Si conoce a alguien que esté planeando un evento, nos encantaría atenderle.',
  },
  apartadoSeguimiento: {
    titulo: 'Seguimiento de apartado',
    texto: 'Hola {cliente}, le escribimos de {marca} sobre la fecha del {fecha} que nos pidió para su {evento}. ¿Sigue interesado? Su apartado vence pronto y con gusto le ayudamos a confirmarlo.',
  },
};

/** Rellena una plantilla. Las variables que faltan quedan vacías y se limpian los espacios sobrantes. */
export function rellenarPlantilla(texto: string, vars: Partial<Record<string, string | null | undefined>>): string {
  return texto
    .replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? '').toString())
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.])/g, '$1')
    .trim();
}
