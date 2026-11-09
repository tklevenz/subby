import { createHash, timingSafeEqual } from 'node:crypto';

export const sha256b64 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
