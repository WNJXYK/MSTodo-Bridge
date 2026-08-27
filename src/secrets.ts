import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Secret handling.
 *
 * Bearer tokens and the admin password are stored only as scrypt hashes.
 * Comparison is fixed-length over hashes so timing never leaks the plaintext.
 * Plaintext of a rotated token is returned exactly once, never persisted.
 */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashSecret(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifySecret(plain: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64url');
  const expected = Buffer.from(parts[2]!, 'base64url');
  const actual = scryptSync(plain, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Fixed-length compare of two opaque strings (hashes both to equal length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
