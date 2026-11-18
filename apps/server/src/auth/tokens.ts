import crypto from 'node:crypto';

/** 256-bit random token, URL-safe. */
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** Tokens are stored only as SHA-256 hashes. */
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Unambiguous characters (no 0/O, 1/I/L) for codes read off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function pairingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}
