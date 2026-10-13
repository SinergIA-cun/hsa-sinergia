import { z } from 'zod';

// Cliente de la API de Emisión de Facturador.com (apidocs.facturador.com).
// OAuth2 (password grant) contra `authcli`, y REST/JSON contra `businessEmision`.
// Los valores van en variables de entorno, nunca en el código: este repositorio es público.

/** Ambiente de pruebas de Facturador. */
export const FACTURADOR_PRUEBAS = {
  authUrl: 'https://authcli.stagefacturador.com',
  apiUrl: 'https://pruebas.stagefacturador.com/BusinessEmision/api/v1',
};

/**
 * Producción (las mandó Facturador el 13-oct-2026). Ojo: aquí la ruta NO lleva
 * `/BusinessEmision`, que en pruebas sí. Se activan con FACTURADOR_AUTH_URL y
 * FACTURADOR_API_URL.
 */
export const FACTURADOR_PRODUCCION = {
  authUrl: 'https://auth.facturador.com',
  apiUrl: 'https://emision-api.facturador.com/api/v1',
};

const opcional = z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined));

const envSchema = z.object({
  FACTURADOR_AUTH_URL: opcional,
  FACTURADOR_API_URL: opcional,
  FACTURADOR_USUARIO: opcional,
  FACTURADOR_PASSWORD_MD5: opcional,
  FACTURADOR_CLIENT_ID: opcional,
  FACTURADOR_CLIENT_SECRET: opcional,
});

export interface FacturadorConfig {
  authUrl: string;
  apiUrl: string;
  /** El RFC de la cuenta. */
  usuario: string;
  /** La contraseña de la cuenta, en MD5 (`es_md5=true`). */
  passwordMd5: string;
  clientId: string;
  clientSecret: string;
}

/** La configuración desde el entorno, o `null` si falta alguna llave. Sin URL, el ambiente de pruebas. */
export function facturadorDesdeEnv(env: NodeJS.ProcessEnv = process.env): FacturadorConfig | null {
  const e = envSchema.parse(env);
  if (!e.FACTURADOR_USUARIO || !e.FACTURADOR_PASSWORD_MD5 || !e.FACTURADOR_CLIENT_ID || !e.FACTURADOR_CLIENT_SECRET) return null;
  return {
    authUrl: (e.FACTURADOR_AUTH_URL ?? FACTURADOR_PRUEBAS.authUrl).replace(/\/$/, ''),
    apiUrl: (e.FACTURADOR_API_URL ?? FACTURADOR_PRUEBAS.apiUrl).replace(/\/$/, ''),
    usuario: e.FACTURADOR_USUARIO,
    passwordMd5: e.FACTURADOR_PASSWORD_MD5,
    clientId: e.FACTURADOR_CLIENT_ID,
    clientSecret: e.FACTURADOR_CLIENT_SECRET,
  };
}

export interface ResultadoComprobante {
  esValido: boolean;
  idComprobante: number;
  uuid: string | null;
  subEstatusId: number;
  descripcion: string | null;
  errores: { codigo: string; mensaje: string }[] | null;
}

export interface SerieFacturador {
  id: number;
  nombre: string;
  folioActual: number | null;
  tipoComprobanteId: number;
  /** "Factura", "Nota de Crédito", "Complemento de pago"… */
  tipoComprobante: string;
}

/**
 * La serie para las facturas: la que se pidió por nombre o, si no, la primera de
 * tipo Factura (tipoComprobanteId 1).
 */
export function serieParaFacturas(series: SerieFacturador[], nombre?: string): SerieFacturador | null {
  if (nombre) return series.find((x) => x.nombre === nombre) ?? null;
  return series.find((x) => x.tipoComprobanteId === 1) ?? series.find((x) => /factura/i.test(x.tipoComprobante)) ?? null;
}

export class FacturadorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cuerpo?: unknown,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class Facturador {
  private token: { access: string; refresh: string; vence: number } | null = null;

  constructor(
    private readonly config: FacturadorConfig,
    private readonly http: Fetch = fetch,
  ) {}

  /** El token vigente; lo pide o lo renueva si hace falta (dura 1 hora). */
  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.vence) return this.token.access;
    const cuerpo = new URLSearchParams(
      this.token
        ? { grant_type: 'refresh_token', refresh_token: this.token.refresh, client_id: this.config.clientId, client_secret: this.config.clientSecret }
        : {
            grant_type: 'password',
            scope: 'offline_access openid APINegocios',
            username: this.config.usuario,
            password: this.config.passwordMd5,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            es_md5: 'true',
          },
    );
    const r = await this.http(`${this.config.authUrl}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    const json = (await r.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string } | null;
    if (!r.ok || !json?.access_token) {
      // Un refresh vencido: se vuelve a pedir con usuario y contraseña.
      if (this.token) {
        this.token = null;
        return this.accessToken();
      }
      throw new FacturadorError(`Facturador no dio token (${r.status}${json?.error ? `: ${json.error}` : ''})`, r.status, json);
    }
    // Un minuto de margen antes de que venza.
    this.token = { access: json.access_token, refresh: json.refresh_token ?? '', vence: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
    return this.token.access;
  }

  private async pedir(ruta: string, init: RequestInit & { base?: 'auth' | 'api' } = {}): Promise<Response> {
    const base = init.base === 'auth' ? this.config.authUrl : this.config.apiUrl;
    const r = await this.http(`${base}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(init.headers ?? {}) },
    });
    if (!r.ok) {
      const texto = await r.text().catch(() => '');
      throw new FacturadorError(`Facturador respondió ${r.status} en ${ruta}${texto ? `: ${texto.slice(0, 300)}` : ''}`, r.status, texto);
    }
    return r;
  }

  /** El emisor de la cuenta (lo que va en las rutas `/emisores/{emisorId}`). */
  async emisor(): Promise<{ emisorId: number; rfc: string }> {
    const r = await this.pedir('/connect/userinfo', { base: 'auth' });
    const j = (await r.json()) as { emisorid?: number | string; rfc?: string };
    if (j.emisorid == null) throw new FacturadorError('Facturador no devolvió el emisorId', undefined, j);
    return { emisorId: Number(j.emisorid), rfc: j.rfc ?? this.config.usuario };
  }

  /** Las series de la cuenta. Facturador exige que el CFDI lleve una que exista (nombre e id). */
  async series(emisorId: number): Promise<SerieFacturador[]> {
    const r = await this.pedir(`/emisores/${emisorId}/series`);
    return (await r.json()) as SerieFacturador[];
  }

  /** Registra y timbra un comprobante. Si el SAT o Facturador lo rechazan, `esValido` viene en false con sus errores. */
  async emitir(emisorId: number, comprobante: unknown): Promise<ResultadoComprobante> {
    const r = await this.pedir(`/emisores/${emisorId}/comprobantes?emitir=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comprobante),
    });
    return (await r.json()) as ResultadoComprobante;
  }

  /** Un comprobante emitido, por su UUID (estatus incluido). */
  async consultar(emisorId: number, uuid: string): Promise<Record<string, unknown>> {
    const r = await this.pedir(`/emisores/${emisorId}/comprobantes/${uuid}`);
    return (await r.json()) as Record<string, unknown>;
  }

  /** El XML timbrado. */
  async xml(emisorId: number, uuid: string): Promise<string> {
    const r = await this.pedir(`/emisores/${emisorId}/descargacomprobantes/${uuid}?tipoContenido=xml`);
    const texto = await r.text();
    // A veces llega como cadena JSON ("<?xml …"): se desenvuelve.
    return texto.startsWith('"') ? (JSON.parse(texto) as string) : texto;
  }

  /** Genera la representación impresa y devuelve el enlace temporal al PDF. */
  async pdfUrl(emisorId: number, uuid: string): Promise<string> {
    await this.pedir(`/emisores/${emisorId}/pdfs/${uuid}`, { method: 'POST', headers: { 'Content-Length': '0' } });
    const r = await this.pedir(`/emisores/${emisorId}/comprobantes/${uuid}/pdf`);
    const texto = (await r.text()).trim();
    return texto.startsWith('"') ? (JSON.parse(texto) as string) : texto;
  }

  /** Cancela con motivo (01 con folio de sustitución, 02, 03 o 04). */
  async cancelar(emisorId: number, uuid: string, motivo: '01' | '02' | '03' | '04', folioSustitucion?: string): Promise<ResultadoComprobante> {
    const r = await this.pedir(`/emisores/${emisorId}/comprobantes/${uuid}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo, ...(folioSustitucion ? { folioSustitucion } : {}) }),
    });
    return (await r.json()) as ResultadoComprobante;
  }
}
