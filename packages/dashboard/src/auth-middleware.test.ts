import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createHumanCheckpointAuth } = require('../auth-middleware.cjs') as {
  createHumanCheckpointAuth(input: {
    cookieSecret: string;
    expectedOrigin: string;
    moltNetUrl: string;
    teamId: string;
  }): {
    middleware(
      request: Record<string, unknown>,
      response: MockResponse,
      next: () => void,
    ): Promise<void>;
  };
};

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  redirectStatus?: number;
  redirectUrl?: string;
  setHeader(name: string, value: string): void;
  end(value: string): void;
  redirect(status: number, url: string): void;
}

afterEach(() => vi.unstubAllGlobals());

describe('dashboard authentication middleware', () => {
  it('redirects an unauthenticated browser before serving the dashboard', async () => {
    const auth = configuredAuth();
    const response = mockResponse();

    await auth.middleware(
      {
        method: 'GET',
        originalUrl: '/dashboard/requests/',
        headers: { accept: 'text/html' },
      },
      response,
      vi.fn(),
    );

    expect(response.redirectStatus).toBe(303);
    expect(response.redirectUrl).toContain('/dashboard/auth/login?return_to=');
  });

  it('rejects unauthenticated workflow APIs without redirecting', async () => {
    const auth = configuredAuth();
    const response = mockResponse();

    await auth.middleware(
      {
        method: 'POST',
        originalUrl: '/dashboard/api/requests/SR-2048/workflow',
        headers: { accept: 'application/json' },
      },
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('Sign in');
  });

  it('fails closed when local authentication has not been bootstrapped', async () => {
    const auth = createHumanCheckpointAuth({
      cookieSecret: '',
      expectedOrigin: 'http://127.0.0.1:1880',
      moltNetUrl: '',
      teamId: '',
    });
    const response = mockResponse();

    await auth.middleware(
      {
        method: 'GET',
        originalUrl: '/dashboard/requests/',
        headers: { accept: 'text/html' },
      },
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('not configured');
  });

  it('allows only the local OIDC consent callback through before sign-in', async () => {
    const auth = configuredAuth();
    const response = mockResponse();
    const next = vi.fn();

    await auth.middleware(
      {
        method: 'GET',
        originalUrl:
          '/dashboard/auth/consent?consent_challenge=local-challenge',
        headers: { accept: 'text/html' },
      },
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.redirectUrl).toBeUndefined();
  });

  it('checks MoltNet team access before allowing a sealed session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const secret = 'a-test-cookie-secret-with-at-least-thirty-two-characters';
    const session = seal(
      { accessToken: 'human-token', expiresAt: Date.now() + 60_000 },
      secret,
    );
    const auth = createHumanCheckpointAuth({
      cookieSecret: secret,
      expectedOrigin: 'http://127.0.0.1:1880',
      moltNetUrl: 'http://127.0.0.1:8080',
      teamId: 'team-1',
    });
    const response = mockResponse();
    const next = vi.fn();

    await auth.middleware(
      {
        method: 'GET',
        originalUrl: '/dashboard/requests/',
        headers: { accept: 'text/html', cookie: `hc_session=${session}` },
      },
      response,
      next,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/teams/team-1',
      expect.objectContaining({
        headers: { authorization: 'Bearer human-token' },
      }),
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

function configuredAuth() {
  return createHumanCheckpointAuth({
    cookieSecret: 'configured-cookie-secret',
    expectedOrigin: 'http://127.0.0.1:1880',
    moltNetUrl: 'http://127.0.0.1:8080',
    teamId: 'team-1',
  });
}

function mockResponse(): MockResponse {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value;
    },
    redirect(status, url) {
      this.redirectStatus = status;
      this.redirectUrl = url;
    },
  };
}

function seal(value: unknown, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    'base64url',
  );
}
