/**
 * La identidad del salón por omisión (Hacienda San Andrés). La web la puede
 * cambiar por instancia (demo) con sus variables `VITE_MARCA_*` / config, y la
 * API con `MARCA_*`: los correos al cliente la usan.
 */
export const MARCA_POR_OMISION = {
  nombre: 'Hacienda San Andrés',
  anio: '1894',
  razonSocial: 'Hacienda San Andrés Atoto, S.A.',
  direccion: 'Atlacomulco No. 1, Col. San Esteban, Naucalpan de Juárez, Estado de México',
  telefono: '5357 1986',
  sitio: 'www.haciendasanandres.com.mx',
} as const;

export type Marca = { [K in keyof typeof MARCA_POR_OMISION]: string };
