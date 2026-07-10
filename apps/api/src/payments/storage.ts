import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredFile {
  key: string;
  mime: string;
}

export interface ComprobanteStorage {
  save(data: Buffer, mime: string): Promise<StoredFile>;
  load(key: string): Promise<Buffer | null>;
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

/** Guarda el comprobante en un directorio del VPS. Reemplazable por un
 *  adaptador de Drive a futuro (misma interfaz `ComprobanteStorage`). */
export class ServerStorage implements ComprobanteStorage {
  constructor(private dir: string) {}

  async save(data: Buffer, mime: string): Promise<StoredFile> {
    await mkdir(this.dir, { recursive: true });
    const key = randomUUID() + (EXT[mime] ?? '');
    await writeFile(join(this.dir, key), data);
    return { key, mime };
  }

  async load(key: string): Promise<Buffer | null> {
    // Anti path-traversal: solo se permite el basename tal cual se generó.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safe || safe !== key) return null;
    try {
      return await readFile(join(this.dir, safe));
    } catch {
      return null;
    }
  }
}
