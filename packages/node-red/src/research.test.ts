import {
  createCheckpointEnvelope,
  type SigningRequestView,
} from '@human-checkpoint/core';
import { describe, expect, it, vi } from 'vitest';

import { invokeExaAfterAuthoritativeApproval } from './research.js';

const created = createCheckpointEnvelope(
  'research-authorization',
  'SR-2048',
  'team-1',
  {
    externalTool: 'exa',
    queries: ['pump vibration'],
    allowedDomains: ['manufacturer.example'],
    maxResults: 2,
    reason: 'Confirm inspection sequence',
    authorizationExpiresAt: '2030-01-01T00:00:00.000Z',
  },
);
const request: SigningRequestView = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  message: created.canonicalMessage,
  nonce: 'nonce',
  purpose: 'human-checkpoint:research-authorization',
  teamId: 'team-1',
  verificationMethod: 'human-hardware-previewsign',
  expiresAt: '2030-01-01T00:00:00.000Z',
  completedAt: '2029-12-31T23:59:00.000Z',
  claimedByHumanId: 'human-1',
  signingCredentialId: 'credential-1',
  valid: true,
  receipt: {
    verificationMethod: 'human-hardware-previewsign',
    value: {} as never,
  },
};
const expected = {
  requestId: request.id,
  teamId: 'team-1',
  checkpoint: 'research-authorization' as const,
  purpose: 'human-checkpoint:research-authorization',
  canonicalMessage: created.canonicalMessage,
  now: new Date('2029-12-31T23:58:00.000Z'),
};

describe('Exa enforcement', () => {
  it('makes one scoped request only after authoritative approval', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { title: 'OEM guide', url: 'https://manufacturer.example/guide' },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      invokeExaAfterAuthoritativeApproval({
        request,
        expected,
        apiKey: 'exa-key',
        fetch,
      }),
    ).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: 'pump vibration',
      numResults: 2,
      includeDomains: ['manufacturer.example'],
    });
  });

  it('does not touch the network for pending or wrong-scope requests', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      invokeExaAfterAuthoritativeApproval({
        request: { ...request, status: 'pending', valid: null, receipt: null },
        expected,
        apiKey: 'exa-key',
        fetch,
      }),
    ).rejects.toThrow(/status_pending/);
    await expect(
      invokeExaAfterAuthoritativeApproval({
        request,
        expected: {
          ...expected,
          canonicalMessage: `${created.canonicalMessage} `,
        },
        apiKey: 'exa-key',
        fetch,
      }),
    ).rejects.toThrow(/wrong_message/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
