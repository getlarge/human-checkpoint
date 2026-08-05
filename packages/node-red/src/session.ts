import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const HUMAN_OIDC_SCOPE =
  'openid offline_access human:profile team:read crypto:sign';

export interface SealedSession {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

export function sealCookie(value: unknown, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function unsealCookie<T>(sealed: string, secret: string): T {
  if (!/^[A-Za-z0-9_-]+$/.test(sealed))
    throw new Error('Invalid sealed cookie');
  const bytes = Buffer.from(sealed, 'base64url');
  if (bytes.toString('base64url') !== sealed)
    throw new Error('Invalid sealed cookie');
  if (bytes.length < 29) throw new Error('Invalid sealed cookie');
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}

export function cookieValue(
  header: string | undefined,
  name: string,
): string | null {
  for (const pair of (header ?? '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name)
      return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `hc_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/dashboard; Max-Age=3600${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `hc_session=; HttpOnly; SameSite=Lax; Path=/dashboard; Max-Age=0${secure ? '; Secure' : ''}`;
}
