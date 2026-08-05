import { describe, expect, it } from 'vitest';

import {
  clearSessionCookie,
  HUMAN_OIDC_SCOPE,
  sealCookie,
  sessionCookie,
  unsealCookie,
} from './session.js';

describe('human OIDC session', () => {
  it('requests crypto:sign and seals tokens instead of exposing JSON', () => {
    expect(HUMAN_OIDC_SCOPE.split(' ')).toContain('crypto:sign');
    const value = { accessToken: 'secret-token', expiresAt: 123 };
    const sealed = sealCookie(value, 'a sufficiently long demo secret');
    expect(sealed).not.toContain('secret-token');
    expect(unsealCookie(sealed, 'a sufficiently long demo secret')).toEqual(
      value,
    );
  });

  it('rejects a modified cookie', () => {
    const sealed = sealCookie({ accessToken: 'secret-token' }, 'secret');
    const modified = `${sealed.slice(0, -1)}${sealed.endsWith('A') ? 'B' : 'A'}`;
    expect(() => unsealCookie(modified, 'secret')).toThrow();
  });

  it('uses host-only HttpOnly cookies for the localhost dashboard', () => {
    for (const cookie of [
      sessionCookie('sealed', false),
      clearSessionCookie(false),
    ]) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/dashboard');
      expect(cookie).not.toContain('Domain=');
      expect(cookie).not.toContain('Secure');
    }
  });
});
