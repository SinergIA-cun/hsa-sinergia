/**
 * Configuración del despliegue, leída EN EL ARRANQUE y no al compilar.
 *
 * Antes todo esto se horneaba con Vite (`import.meta.env.VITE_*`), y eso tenía
 * una trampa cara: `VITE_API_URL` traía como valor por omisión el dominio de la
 * API de producción. Una segunda instancia construida del mismo repo sin
 * `build arg` —el demo, por ejemplo— servía una app que le pegaba a la API DEL
 * CLIENTE. Un prospecto jugando en la demo habría estado escribiendo en la base
 * de producción, y nada en la pantalla lo delataba.
 *
 * Ahora el contenedor escribe `/config.js` al arrancar, con lo que traiga su
 * entorno, y la app lo lee de ahí. Una sola imagen sirve para las dos
 * instancias, cambiar el nombre del demo no exige reconstruir, y olvidar una
 * variable ya no significa apuntarle a la base de otro.
 *
 * El orden es: lo que diga el arranque, si no lo que se horneó al compilar (que
 * es como sigue funcionando `pnpm dev`), si no el valor por omisión.
 */
declare global {
  interface Window {
    __HSA_CONFIG__?: Record<string, string>;
  }
}

/**
 * `undefined` significa "nadie la definió" y cae al siguiente escalón. Una
 * cadena VACÍA es una respuesta legítima —así se esconde el año bajo el logo— y
 * se respeta.
 */
export function config(llave: string, alCompilar: string | undefined): string | undefined {
  const alArrancar = typeof window !== 'undefined' ? window.__HSA_CONFIG__?.[llave] : undefined;
  return alArrancar ?? alCompilar;
}
