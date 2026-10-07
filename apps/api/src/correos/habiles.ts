/**
 * Suma días hábiles (lunes a viernes) a una fecha civil (UTC a medianoche, como
 * `fechaEvento`). No conoce días festivos: el correo de cierre puede salir un
 * día festivo, que no hace daño.
 */
export function sumarHabiles(fecha: Date, dias: number): Date {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  let faltan = dias;
  while (faltan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) faltan--;
  }
  return d;
}
