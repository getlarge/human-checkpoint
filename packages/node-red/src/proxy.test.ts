import { describe, expect, it, vi } from 'vitest';

import { createSigningProxy } from './proxy.js';

function proxy(fetch = vi.fn<typeof globalThis.fetch>()) {
  return {
    fetch,
    handler: createSigningProxy({
      moltNetUrl: 'https://api.themolt.net',
      teamId: 'team-1',
      expectedOrigin: 'https://checkpoint.example',
      getAccessToken: async () => 'secret-access-token',
      fetch,
    }),
  };
}

describe('same-origin signing proxy', () => {
  it('rejects unlisted methods and paths without an upstream request', async () => {
    const { handler, fetch } = proxy();
    const result = await handler({
      method: 'DELETE',
      url: '/dashboard/api/signing/crypto/signing-credentials/x',
      headers: {},
    });
    expect(result.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong origin',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
      403,
    ],
    [
      'missing JSON',
      { origin: 'https://checkpoint.example', 'content-type': 'text/plain' },
      415,
    ],
    [
      'oversize',
      {
        origin: 'https://checkpoint.example',
        'content-type': 'application/json',
        'content-length': '65537',
      },
      413,
    ],
  ])('rejects %s mutations', async (_label, headers, status) => {
    const { handler, fetch } = proxy();
    const result = await handler({
      method: 'POST',
      url: '/dashboard/api/signing/crypto/signing-requests/11111111-1111-4111-8111-111111111111/claim',
      headers,
      body: Buffer.from('{}'),
    });
    expect(result.status).toBe(status);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('injects auth and team server-side and never discloses tokens', async () => {
    const upstream = new Response(
      JSON.stringify({
        id: 'request-1',
        access_token: 'must-not-leak',
        nested: { refresh_token: 'nope' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(upstream);
    const { handler } = proxy(fetch);
    const result = await handler({
      method: 'GET',
      url: '/dashboard/api/signing/crypto/signing-requests?scope=signable',
      headers: { cookie: 'hc_session=opaque' },
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"id":"request-1","nested":{}}');
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer secret-access-token',
      'x-moltnet-team-id': 'team-1',
    });
  });

  it('returns 401 when the HttpOnly session has no access token', async () => {
    const handler = createSigningProxy({
      moltNetUrl: 'https://api.themolt.net',
      teamId: 'team-1',
      expectedOrigin: 'https://checkpoint.example',
      getAccessToken: async () => null,
    });
    expect(
      await handler({
        method: 'GET',
        url: '/dashboard/api/signing/crypto/signing-credentials',
        headers: {},
      }),
    ).toMatchObject({ status: 401 });
  });
});
