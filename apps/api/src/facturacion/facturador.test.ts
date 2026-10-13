import { describe, it, expect } from 'vitest';
import { Facturador, FacturadorError, facturadorDesdeEnv, serieParaFacturas, FACTURADOR_PRUEBAS, FACTURADOR_PRODUCCION, type FacturadorConfig } from './facturador.js';

const config: FacturadorConfig = {
  authUrl: 'https://auth.test',
  apiUrl: 'https://api.test/BusinessEmision/api/v1',
  usuario: 'RFC_PRUEBA',
  passwordMd5: 'md5-de-prueba',
  clientId: 'cliente',
  clientSecret: 'secreto',
};

/** Un servidor de mentiras: guarda las peticiones y contesta según la ruta. */
function servidor(respuestas: Record<string, (init: RequestInit) => Response>) {
  const pedidas: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string | URL, init: RequestInit = {}) => {
    pedidas.push({ url: String(url), init });
    const clave = Object.keys(respuestas).find((k) => String(url).includes(k));
    return clave ? respuestas[clave]!(init) : new Response('no existe', { status: 404 });
  }) as typeof fetch;
  return { http, pedidas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const token = () => json({ access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600 });

describe('cliente de Facturador', () => {
  it('pide el token con usuario, contraseña MD5 y llaves, y lo reusa', async () => {
    const s = servidor({ '/connect/token': token, '/connect/userinfo': () => json({ emisorid: '208', rfc: 'RFC_PRUEBA' }) });
    const f = new Facturador(config, s.http);
    expect(await f.emisor()).toEqual({ emisorId: 208, rfc: 'RFC_PRUEBA' });
    await f.emisor();
    const tokens = s.pedidas.filter((p) => p.url.endsWith('/connect/token'));
    expect(tokens).toHaveLength(1);
    const body = new URLSearchParams(String(tokens[0]!.init.body));
    expect(Object.fromEntries(body)).toMatchObject({ grant_type: 'password', username: 'RFC_PRUEBA', password: 'md5-de-prueba', client_id: 'cliente', client_secret: 'secreto', es_md5: 'true' });
    expect(body.get('scope')).toContain('APINegocios');
    const info = s.pedidas.find((p) => p.url.endsWith('/connect/userinfo'))!;
    expect((info.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('emite, baja el XML y cancela en las rutas del emisor', async () => {
    const s = servidor({
      '/connect/token': token,
      '/comprobantes?emitir=true': () => json({ esValido: true, idComprobante: 1, uuid: 'UUID-1', subEstatusId: 2, descripcion: null, errores: null }),
      '/descargacomprobantes/UUID-1': () => new Response(JSON.stringify('<?xml version="1.0"?><cfdi:Comprobante/>')),
      '/comprobantes/UUID-1': (init) =>
        init.method === 'DELETE'
          ? json({ esValido: true, idComprobante: 1, uuid: 'UUID-1', subEstatusId: 3, descripcion: 'Cancelado (Directo)', errores: [] })
          : json({ uuid: 'UUID-1', estatus: 'Emitido' }),
    });
    const f = new Facturador(config, s.http);
    const r = await f.emitir(208, { version: '4.0' });
    expect(r.uuid).toBe('UUID-1');
    expect(s.pedidas.at(-1)!.url).toBe('https://api.test/BusinessEmision/api/v1/emisores/208/comprobantes?emitir=true');
    expect(await f.xml(208, 'UUID-1')).toMatch(/^<\?xml/);
    expect(await f.consultar(208, 'UUID-1')).toMatchObject({ estatus: 'Emitido' });
    const c = await f.cancelar(208, 'UUID-1', '02');
    expect(c.descripcion).toBe('Cancelado (Directo)');
    expect(s.pedidas.at(-1)!.init).toMatchObject({ method: 'DELETE', body: JSON.stringify({ motivo: '02' }) });
  });

  it('un token rechazado y un error del servidor se explican', async () => {
    const sinToken = servidor({ '/connect/token': () => json({ error: 'invalid_grant' }, 400) });
    await expect(new Facturador(config, sinToken.http).emisor()).rejects.toThrow(/no dio token \(400: invalid_grant\)/);
    const caido = servidor({ '/connect/token': token, '/comprobantes': () => new Response('Error interno', { status: 500 }) });
    await expect(new Facturador(config, caido.http).emitir(208, {})).rejects.toBeInstanceOf(FacturadorError);
  });

  it('sin llaves no hay configuración; sin URL usa el ambiente de pruebas', () => {
    expect(facturadorDesdeEnv({})).toBeNull();
    const c = facturadorDesdeEnv({ FACTURADOR_USUARIO: 'X', FACTURADOR_PASSWORD_MD5: 'Y', FACTURADOR_CLIENT_ID: 'Z', FACTURADOR_CLIENT_SECRET: 'W' });
    expect(c).toMatchObject({ authUrl: FACTURADOR_PRUEBAS.authUrl, apiUrl: FACTURADOR_PRUEBAS.apiUrl });
  });

  it('en producción las rutas no llevan /BusinessEmision', async () => {
    const s = servidor({ '/connect/token': token, '/comprobantes?emitir=true': () => json({ esValido: true, idComprobante: 9, uuid: 'U', subEstatusId: 2, descripcion: null, errores: null }) });
    const prod = facturadorDesdeEnv({
      FACTURADOR_USUARIO: 'X', FACTURADOR_PASSWORD_MD5: 'Y', FACTURADOR_CLIENT_ID: 'Z', FACTURADOR_CLIENT_SECRET: 'W',
      FACTURADOR_AUTH_URL: FACTURADOR_PRODUCCION.authUrl, FACTURADOR_API_URL: FACTURADOR_PRODUCCION.apiUrl,
    })!;
    await new Facturador(prod, s.http).emitir(55, {});
    expect(s.pedidas.map((p) => p.url)).toEqual([
      'https://auth.facturador.com/connect/token',
      'https://emision-api.facturador.com/api/v1/emisores/55/comprobantes?emitir=true',
    ]);
  });
});

describe('serie para facturas', () => {
  const series = [
    { id: 1302, nombre: '1', folioActual: 86, tipoComprobanteId: 3, tipoComprobante: 'Nota de Crédito' },
    { id: 1395, nombre: '001', folioActual: 3738, tipoComprobanteId: 1, tipoComprobante: 'Factura' },
  ];
  it('elige la de facturas, o la que se pida por nombre', () => {
    expect(serieParaFacturas(series)?.id).toBe(1395);
    expect(serieParaFacturas(series, '1')?.id).toBe(1302);
    expect(serieParaFacturas(series, 'X')).toBeNull();
    expect(serieParaFacturas([])).toBeNull();
  });
});
