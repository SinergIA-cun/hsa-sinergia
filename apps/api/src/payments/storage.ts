export interface UploadResult {
  url: string | null;
  pendiente: boolean;
}

/** Abstracción de almacenamiento del comprobante. El adaptador Drive real
 *  (googleapis) se implementa en un sub-plan aparte, gated por credencial. */
export interface ComprobanteStorage {
  upload(data: Buffer, contentType: string): Promise<UploadResult>;
  stream(ref: string): Promise<NodeJS.ReadableStream | null>;
}

/** Default sin credencial: no sube nada, deja el pago con comprobante pendiente. */
export class PendingStorage implements ComprobanteStorage {
  async upload(): Promise<UploadResult> {
    return { url: null, pendiente: true };
  }
  async stream(): Promise<NodeJS.ReadableStream | null> {
    return null;
  }
}
