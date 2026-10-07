import { MARCA_POR_OMISION, type Marca } from '@hsa/shared';
import type { AppConfig } from '../config.js';

/** La identidad que firma los correos: la de la configuración, o la de la hacienda. */
export function marcaDe(config: AppConfig): Marca {
  return {
    ...MARCA_POR_OMISION,
    ...(config.MARCA_NOMBRE ? { nombre: config.MARCA_NOMBRE } : {}),
    ...(config.MARCA_RAZON_SOCIAL ? { razonSocial: config.MARCA_RAZON_SOCIAL } : {}),
    ...(config.MARCA_DIRECCION ? { direccion: config.MARCA_DIRECCION } : {}),
    ...(config.MARCA_TELEFONO ? { telefono: config.MARCA_TELEFONO } : {}),
    ...(config.MARCA_SITIO ? { sitio: config.MARCA_SITIO } : {}),
  };
}
