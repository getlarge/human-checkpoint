import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acceptLocalConsent,
  humanLogoutTarget,
  isRequestAttachmentId,
  readSigningRequestBody,
} from './http-routes.js';
import { MAX_SIGNING_BODY_BYTES } from './proxy.js';

afterEach(() => vi.unstubAllGlobals());

describe('local dashboard consent', () => {
  it('accepts only the generated dashboard client and exact requested scopes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          client: { client_id: 'dashboard-client' },
          requested_scope: ['openid', 'team:read', 'crypto:sign'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirect_to: 'http://localhost:4444/continue' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    let status = 200;
    let body = '';
    let redirect = '';

    await acceptLocalConsent(
      { query: { consent_challenge: 'challenge/one' } },
      {
        status(value) {
          status = value;
          return this;
        },
        send(value) {
          body = value;
        },
        redirect(value) {
          redirect = value;
        },
      },
      {
        hydraAdminUrl: 'http://127.0.0.1:4445/',
        clientId: 'dashboard-client',
      },
    );

    expect(status).toBe(200);
    expect(body).toBe('');
    expect(redirect).toBe('http://localhost:4444/continue');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4445/admin/oauth2/auth/requests/consent?consent_challenge=challenge%2Fone',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4445/admin/oauth2/auth/requests/consent/accept?consent_challenge=challenge%2Fone',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          grant_scope: ['openid', 'team:read', 'crypto:sign'],
          remember: true,
          remember_for: 3600,
        }),
      }),
    );
  });
});

describe('signing HTTP request body', () => {
  it('reads a streamed JSON body for the same-origin signing proxy', async () => {
    const request = Readable.from([
      Buffer.from('{"credentialType":'),
      Buffer.from('"preview-sign-arkg"}'),
    ]);

    await expect(
      readSigningRequestBody(
        Object.assign(request, { method: 'POST' }) as Readable & {
          method: string;
        },
      ),
    ).resolves.toEqual({
      body: Buffer.from('{"credentialType":"preview-sign-arkg"}'),
      tooLarge: false,
    });
  });

  it('caps streamed mutations before retaining an oversized body', async () => {
    const request = Readable.from([
      Buffer.alloc(MAX_SIGNING_BODY_BYTES, 97),
      Buffer.from('b'),
    ]);

    await expect(
      readSigningRequestBody(
        Object.assign(request, { method: 'POST' }) as Readable & {
          method: string;
        },
      ),
    ).resolves.toEqual({ tooLarge: true });
  });
});

describe('human logout target', () => {
  it('uses the configured loopback Ory logout page', () => {
    expect(
      humanLogoutTarget(
        'http://localhost:4433/self-service/logout/browser?return_to=http%3A%2F%2Flocalhost%3A1880%2Fdashboard%2Fui%2Fhardware-setup',
      ),
    ).toBe(
      'http://localhost:4433/self-service/logout/browser?return_to=http%3A%2F%2Flocalhost%3A1880%2Fdashboard%2Fui%2Fhardware-setup',
    );
  });

  it('does not redirect a session cookie logout to an external origin', () => {
    expect(humanLogoutTarget('https://attacker.example/logout')).toBe(
      '/dashboard/ui/hardware-setup',
    );
    expect(humanLogoutTarget(undefined)).toBe('/dashboard/ui/hardware-setup');
  });
});

describe('request attachment route', () => {
  it('accepts only the seeded attachment identifier shape', () => {
    expect(isRequestAttachmentId('ATT-881')).toBe(true);
    expect(isRequestAttachmentId('../ATT-881')).toBe(false);
    expect(isRequestAttachmentId('ATT-881.webp')).toBe(false);
    expect(isRequestAttachmentId('SR-2075')).toBe(false);
  });
});
