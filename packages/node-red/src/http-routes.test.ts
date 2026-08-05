import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { humanLogoutTarget, readSigningRequestBody } from './http-routes.js';
import { MAX_SIGNING_BODY_BYTES } from './proxy.js';

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
        'http://localhost:4433/self-service/logout/browser?return_to=http%3A%2F%2Flocalhost%3A1880%2Fdashboard%2Fhardware-setup%2F',
      ),
    ).toBe(
      'http://localhost:4433/self-service/logout/browser?return_to=http%3A%2F%2Flocalhost%3A1880%2Fdashboard%2Fhardware-setup%2F',
    );
  });

  it('does not redirect a session cookie logout to an external origin', () => {
    expect(humanLogoutTarget('https://attacker.example/logout')).toBe(
      '/dashboard/hardware-setup/',
    );
    expect(humanLogoutTarget(undefined)).toBe('/dashboard/hardware-setup/');
  });
});
