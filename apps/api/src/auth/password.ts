import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface PasswordHasher {
  hash(password: string): string;
  verify(password: string, hash: string): boolean;
}

const KEYLEN = 64;

export class ScryptHasher implements PasswordHasher {
  private saltBytes = 16;
  private cost = 16384;
  private blockSize = 8;

  hash(password: string): string {
    const salt = randomBytes(this.saltBytes);
    const derived = scryptSync(password, salt, KEYLEN, { N: this.cost, r: this.blockSize });
    return `scrypt$${this.cost}$${this.blockSize}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  verify(password: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 5 || parts[0] !== 'scrypt') return false;
    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const saltB64 = parts[3];
    const expectedB64 = parts[4];
    if (!saltB64 || !expectedB64) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(expectedB64, 'base64');
    const derived = scryptSync(password, salt, KEYLEN, { N: cost, r: blockSize });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
