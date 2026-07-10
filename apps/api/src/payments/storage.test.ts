import { describe, it, expect } from 'vitest';
import { PendingStorage } from './storage.js';

describe('PendingStorage', () => {
  it('no sube: marca pendiente y no da url', async () => {
    const s = new PendingStorage();
    const r = await s.upload(Buffer.from('x'), 'image/jpeg');
    expect(r.url).toBeNull();
    expect(r.pendiente).toBe(true);
  });
});
