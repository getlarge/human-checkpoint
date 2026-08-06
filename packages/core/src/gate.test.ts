import { describe, expect, it, vi } from 'vitest';

import { createCheckpointEnvelope } from './envelope.js';
import { assertApprovedCheckpoint, runAuthorizedResearch } from './gate.js';
import type { SigningRequestView } from './types.js';

const created = createCheckpointEnvelope(
  'research-authorization',
  'SR-2048',
  'team-1',
  {
    externalTool: 'exa',
    queries: ['pump vibration OEM service bulletin'],
    allowedDomains: ['manufacturer.example'],
    maxResults: 3,
    reason: 'Confirm safe inspection steps',
    authorizationExpiresAt: '2030-01-01T00:00:00.000Z',
  },
);

const approved: SigningRequestView = {
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
  requestId: approved.id,
  teamId: 'team-1',
  checkpoint: 'research-authorization' as const,
  purpose: 'human-checkpoint:research-authorization',
  canonicalMessage: created.canonicalMessage,
  now: new Date('2029-12-31T23:58:00.000Z'),
};

describe('authoritative research gate', () => {
  it('never invokes the external adapter before approval', async () => {
    const invoke = vi.fn();
    await expect(
      runAuthorizedResearch({
        request: { ...approved, status: 'pending', valid: null, receipt: null },
        expected,
        invoke,
      }),
    ).rejects.toThrow(/status_pending/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes only after every authoritative binding matches', async () => {
    const invoke = vi.fn().mockResolvedValue(['result']);
    await expect(
      runAuthorizedResearch({ request: approved, expected, invoke }),
    ).resolves.toEqual(['result']);
    expect(invoke).toHaveBeenCalledWith(created.envelope.payload);
  });

  it.each([
    ['rejected', { status: 'rejected' }],
    ['expired', { status: 'expired' }],
    ['wrong team', { teamId: 'team-2' }],
    ['wrong method', { verificationMethod: 'agent-ed25519' }],
    ['wrong purpose', { purpose: 'something-else' }],
    ['invalid proof', { valid: false }],
    ['missing proof', { receipt: null }],
    ['wrong request', { id: '22222222-2222-4222-8222-222222222222' }],
  ] satisfies Array<[string, Partial<SigningRequestView>]>)(
    'blocks %s',
    (_label, change) => {
      expect(() =>
        assertApprovedCheckpoint({ ...approved, ...change }, expected),
      ).toThrow(/Checkpoint denied/);
    },
  );

  it('blocks a changed canonical scope and an expired authorization', () => {
    const changed = createCheckpointEnvelope(
      'research-authorization',
      'SR-2048',
      'team-1',
      {
        ...created.envelope.payload,
        maxResults: 4,
      } as never,
    );
    expect(() =>
      assertApprovedCheckpoint(
        { ...approved, message: changed.canonicalMessage },
        expected,
      ),
    ).toThrow(/wrong_message/);
    expect(() =>
      assertApprovedCheckpoint(approved, {
        ...expected,
        now: new Date('2030-01-01T00:00:00.001Z'),
      }),
    ).toThrow(/authorization_expired/);
  });
});
