export class ApiError extends Error {
  status: number;
  /**
   * El cuerpo completo de la respuesta de error.
   *
   * Antes solo se guardaba el mensaje, y por eso un 409 que ya traía el detalle
   * —"lo usan estos contratos", con la lista— llegaba a la pantalla como un
   * texto sin ligas. Lo que el servidor se toma el trabajo de explicar, la
   * interfaz tiene que poder usarlo.
   */
  datos: unknown;
  constructor(status: number, message: string, datos?: unknown) {
    super(message);
    this.status = status;
    this.datos = datos;
  }
}

// Si la API vive en su propio dominio (p.ej. hsapi.somossinergia.com), se
// hornea en build time con VITE_API_URL. Vacío por defecto => rutas relativas
// (mismo dominio, útil con el proxy /api de nginx en el compose de VPS).
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

function resolveUrl(url: string): string {
  return url.startsWith('/api') || url.startsWith('/health') ? `${API_BASE}${url}` : url;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(resolveUrl(url), {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (data && (data.error as string)) || `Error ${res.status}`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
