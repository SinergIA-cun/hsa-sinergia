import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ServerStorage } from './storage.js';

const dir = join(tmpdir(), 'hsa-storage-test-' + randomUUID());
const storage = new ServerStorage(dir);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ServerStorage', () => {
  it('save guarda y load recupera los mismos bytes', async () => {
    const stored = await storage.save(Buffer.from('abc'), 'image/jpeg');
    expect(stored.key.endsWith('.jpg')).toBe(true);
    expect(stored.mime).toBe('image/jpeg');
    const loaded = await storage.load(stored.key);
    expect(loaded?.toString()).toBe('abc');
  });

  it('load bloquea path traversal', async () => {
    expect(await storage.load('../../etc/passwd')).toBeNull();
  });

  it('load devuelve null si no existe', async () => {
    expect(await storage.load('no-existe.jpg')).toBeNull();
  });
});
