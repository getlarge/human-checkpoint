import { describe, expect, it } from 'vitest';

import { canonicalJson, parseCanonicalJson } from './canonical.js';
import {
  createCheckpointEnvelope,
  parseCheckpointEnvelope,
} from './envelope.js';

describe('canonical JSON', () => {
  it('sorts keys by UTF-8 bytes and is stable', () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: null } })).toBe(
      '{"a":{"b":null,"y":true},"z":1}',
    );
  });

  it.each([
    ['non-finite number', { value: Number.NaN }],
    ['undefined', { value: undefined }],
    ['date', { value: new Date() }],
    ['map', { value: new Map() }],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });

  it('rejects array holes', () => {
    const value = new Array(2);
    value[1] = 'present';
    expect(() => canonicalJson(value)).toThrow(/array hole/);
  });

  it('rejects non-canonical re-encoding and unknown envelope fields', () => {
    const { canonicalMessage } = createCheckpointEnvelope(
      'research-authorization',
      'SR-2048',
      'team-1',
      {
        externalTool: 'exa',
        queries: ['pump vibration OEM service bulletin'],
        allowedDomains: ['example.com'],
        maxResults: 3,
        reason: 'Confirm the safe inspection sequence',
        authorizationExpiresAt: '2030-01-01T00:00:00.000Z',
      },
    );
    expect(parseCheckpointEnvelope(canonicalMessage).checkpoint).toBe(
      'research-authorization',
    );
    expect(() => parseCanonicalJson(` ${canonicalMessage}`)).toThrow(
      /not the canonical/,
    );
    const injected = JSON.parse(canonicalMessage) as Record<string, unknown>;
    injected.admin = true;
    expect(() => parseCheckpointEnvelope(canonicalJson(injected))).toThrow(
      /unknown or missing/,
    );
  });

  it('binds the actual service request and rejects malformed request IDs', () => {
    const payload = {
      externalTool: 'exa' as const,
      queries: ['Dorner 2100 belt tracking guidance'],
      allowedDomains: ['dornerconveyors.com'],
      maxResults: 3,
      reason: 'Prepare the claimed conveyor request',
      authorizationExpiresAt: '2030-01-01T00:00:00.000Z',
    };
    expect(
      createCheckpointEnvelope(
        'research-authorization',
        'SR-2075',
        'team-1',
        payload,
      ).envelope.serviceRequestId,
    ).toBe('SR-2075');
    expect(() =>
      createCheckpointEnvelope(
        'research-authorization',
        '../SR-2075',
        'team-1',
        payload,
      ),
    ).toThrow(/envelope identity/);
  });
});
