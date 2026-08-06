import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it } from 'vitest';

import { canonicalBytes, canonicalJson, sha256Base64Url } from './canonical.js';
import { createCheckpointEnvelope } from './envelope.js';
import {
  buildSigningBytes,
  createProofBundle,
  verifyProofArtifact,
} from './proof.js';
import type {
  Esp256PublicKey,
  PreviewSignEvidence,
  SigningRequestView,
} from './types.js';

function publicKey(secret: Uint8Array): Esp256PublicKey {
  const point = p256.getPublicKey(secret, false);
  return {
    kty: 2,
    algorithm: -9,
    curve: 1,
    x: Buffer.from(point.slice(1, 33)).toString('base64url'),
    y: Buffer.from(point.slice(33)).toString('base64url'),
  };
}

function completedRequest(input: {
  checkpoint: 'research-authorization' | 'field-release';
  message: string;
  purpose: string;
  id: string;
  secretByte: number;
}): SigningRequestView {
  const nonce = `nonce-${input.secretByte}`;
  const credentialId = '33333333-3333-4333-8333-333333333333';
  const claimantId = '44444444-4444-4444-8444-444444444444';
  const expiresAt = '2030-01-01T00:00:00.000Z';
  const signingEnvelope = {
    version: 1,
    audience: 'moltnet:preview-sign',
    operation: 'signing-request',
    requestId: input.id,
    credentialId,
    verificationMethod: 'human-hardware-previewsign',
    teamId: 'team-1',
    claimantId,
    nonce,
    purpose: input.purpose,
    expiresAt,
    signingPayload: Buffer.from(
      buildSigningBytes(input.message, nonce),
    ).toString('base64'),
    publicMaterialHash: Buffer.alloc(32, input.secretByte).toString(
      'base64url',
    ),
  };
  const envelopeBytes = canonicalBytes(signingEnvelope);
  const digest = sha256Base64Url(envelopeBytes);
  const secret = new Uint8Array(32).fill(input.secretByte);
  const signature = p256.sign(Buffer.from(digest, 'base64url'), secret, {
    format: 'der',
    prehash: false,
  });
  const evidenceWithoutHash = {
    version: 1 as const,
    operation: 'signing-request' as const,
    requestId: input.id,
    credentialId,
    teamId: 'team-1',
    claimantId,
    verificationMethod: 'human-hardware-previewsign' as const,
    nonce,
    purpose: input.purpose,
    expiresAt,
    envelope: Buffer.from(envelopeBytes).toString('base64url'),
    digest,
    additionalArgumentsHash: Buffer.alloc(32, 9).toString('base64url'),
    derivedPublicKey: publicKey(secret),
    signature: Buffer.from(signature).toString('base64url'),
  };
  const evidence: PreviewSignEvidence = {
    ...evidenceWithoutHash,
    proofHash: sha256Base64Url(canonicalBytes(evidenceWithoutHash)),
  };
  return {
    id: input.id,
    status: 'completed',
    message: input.message,
    nonce,
    purpose: input.purpose,
    teamId: 'team-1',
    verificationMethod: 'human-hardware-previewsign',
    expiresAt,
    completedAt: '2029-12-31T23:59:00.000Z',
    claimedByHumanId: claimantId,
    signingCredentialId: credentialId,
    valid: true,
    receipt: {
      verificationMethod: 'human-hardware-previewsign',
      value: evidence,
    },
  };
}

describe('offline proof', () => {
  const researchMessage = createCheckpointEnvelope(
    'research-authorization',
    'team-1',
    {
      externalTool: 'exa',
      queries: ['pump vibration OEM service bulletin'],
      allowedDomains: ['manufacturer.example'],
      maxResults: 3,
      reason: 'Confirm safe inspection steps',
      authorizationExpiresAt: '2030-01-01T00:00:00.000Z',
    },
  ).canonicalMessage;
  const releaseMessage = createCheckpointEnvelope('field-release', 'team-1', {
    brief: {
      finding: 'Inspect coupling alignment before returning to service.',
    },
    fieldAmendment:
      'Install a temporary exclusion marker at the south access point.',
    disposition: 'accepted-with-field-amendment',
    role: 'Lead field technician',
    shift: 'Day / A',
  }).canonicalMessage;
  const artifact = createProofBundle({
    teamId: 'team-1',
    research: completedRequest({
      checkpoint: 'research-authorization',
      message: researchMessage,
      purpose: 'human-checkpoint:research-authorization',
      id: '11111111-1111-4111-8111-111111111111',
      secretByte: 7,
    }),
    release: completedRequest({
      checkpoint: 'field-release',
      message: releaseMessage,
      purpose: 'human-checkpoint:field-release',
      id: '22222222-2222-4222-8222-222222222222',
      secretByte: 8,
    }),
    exportedAt: new Date('2029-12-31T23:59:30.000Z'),
  });

  it('verifies both signatures offline and requires distinct derived keys', () => {
    const report = verifyProofArtifact(artifact);
    expect(report).toMatchObject({
      valid: true,
      proofHashValid: true,
      keysDiffer: true,
    });
    expect(report.checkpoints.every((checkpoint) => checkpoint.valid)).toBe(
      true,
    );
  });

  it('fails after a one-character amendment mutation', () => {
    const tampered = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    tampered.checkpoints[1].canonicalMessage =
      tampered.checkpoints[1].canonicalMessage.replace('Install', 'install');
    const report = verifyProofArtifact(tampered);
    expect(report.valid).toBe(false);
    expect(report.errors).toContain(
      'request-scoped derived public keys could not be compared because a checkpoint failed verification',
    );
    expect(report.errors).not.toContain(
      'request-scoped derived public keys are equal',
    );
  });

  it('still fails if an attacker recomputes only the outer proof hash', () => {
    const tampered = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    tampered.checkpoints[1].canonicalMessage =
      tampered.checkpoints[1].canonicalMessage.replace('Install', 'install');
    const { proofHash: _ignored, ...withoutHash } = tampered;
    tampered.proofHash = sha256Base64Url(canonicalBytes(withoutHash));
    const report = verifyProofArtifact(tampered);
    expect(report.valid).toBe(false);
    expect(report.checkpoints[1]?.errors.join(' ')).toMatch(/signed payload/);
  });

  it('serializes without hidden non-canonical values', () => {
    expect(() => canonicalJson(artifact)).not.toThrow();
  });
});
