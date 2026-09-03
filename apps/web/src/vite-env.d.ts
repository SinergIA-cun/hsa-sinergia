/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** La API detrás de la app. Vacío = rutas relativas (mismo dominio). */
  readonly VITE_API_URL?: string;
  /** La identidad del salón. Ver `src/lib/marca.ts`. */
  readonly VITE_MARCA_NOMBRE?: string;
  readonly VITE_MARCA_ANIO?: string;
  readonly VITE_MARCA_RAZON_SOCIAL?: string;
  readonly VITE_MARCA_DIRECCION?: string;
  readonly VITE_MARCA_DIRECCION_CORTA?: string;
  readonly VITE_MARCA_TELEFONO?: string;
  readonly VITE_MARCA_SITIO?: string;
  readonly VITE_MARCA_DOMINIO_CORREO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
