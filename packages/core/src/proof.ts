import {
  fromBase64Url,
  verifyP256PrehashedSignature,
} from '@themoltnet/yubikey-preview-sign';
import {
  asRecord,
  assertExactKeys,
  canonicalBytes,
  canonicalJson,
  parseCanonicalJson,
  sha256Base64Url,
} from './canonical.js';
import { parseCheckpointEnvelope } from './envelope.js';
import {
  HARDWARE_METHOD,
  type HumanCheckpointProof,
  PROOF_VERSION,
  type ProofCheckpoint,
  SERVICE_REQUEST_ID,
  type SigningRequestView,
} from './types.js';

const PURPOSES = {
  'research-authorization': 'human-checkpoint:research-authorization',
  'field-release': 'human-checkpoint:field-release',
} as const;

export interface VerificationCheck {
  checkpoint: string;
  valid: boolean;
  errors: string[];
  requestId?: string;
  derivedPublicKey?: string;
}
export interface ProofVerificationReport {
  valid: boolean;
  proofHashValid: boolean;
  keysDiffer: boolean;
  checkpoints: VerificationCheck[];
  errors: string[];
}

export function createProofBundle(input: {
  teamId: string;
  research: SigningRequestView;
  release: SigningRequestView;
  exportedAt?: Date;
}): HumanCheckpointProof {
  const checkpoints: [ProofCheckpoint, ProofCheckpoint] = [
    exportCheckpoint('research-authorization', input.research, input.teamId),
    exportCheckpoint('field-release', input.release, input.teamId),
  ];
  const withoutHash = {
    format: PROOF_VERSION,
    serviceRequestId: SERVICE_REQUEST_ID,
    teamId: input.teamId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    checkpoints,
  };
  return {
    ...withoutHash,
    proofHash: sha256Base64Url(canonicalBytes(withoutHash)),
  };
}

export function verifyProofArtifact(value: unknown): ProofVerificationReport {
  const errors: string[] = [];
  let proofHashValid = false;
  let checkpoints: VerificationCheck[] = [];
  let keysDiffer = false;
  try {
    const artifact = parseArtifact(value);
    const { proofHash, ...withoutHash } = artifact;
    proofHashValid = proofHash === sha256Base64Url(canonicalBytes(withoutHash));
    if (!proofHashValid) errors.push('artifact proofHash mismatch');
    checkpoints = artifact.checkpoints.map((checkpoint) =>
      verifyCheckpoint(checkpoint, artifact.teamId),
    );
    const keys = checkpoints.map((checkpoint) => checkpoint.derivedPublicKey);
    keysDiffer = Boolean(keys[0] && keys[1] && keys[0] !== keys[1]);
    // A failed checkpoint reports no derived key. Saying the keys are equal
    // would be a false claim about evidence that was never compared.
    if (!keys[0] || !keys[1])
      errors.push(
        'request-scoped derived public keys could not be compared because a checkpoint failed verification',
      );
    else if (!keysDiffer)
      errors.push('request-scoped derived public keys are equal');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    valid:
      proofHashValid &&
      keysDiffer &&
      checkpoints.length === 2 &&
      checkpoints.every((item) => item.valid),
    proofHashValid,
    keysDiffer,
    checkpoints,
    errors,
  };
}

function exportCheckpoint(
  checkpoint: ProofCheckpoint['checkpoint'],
  request: SigningRequestView,
  teamId: string,
): ProofCheckpoint {
  if (
    request.status !== 'completed' ||
    request.teamId !== teamId ||
    request.verificationMethod !== HARDWARE_METHOD ||
    request.valid !== true ||
    !request.completedAt ||
    !request.claimedByHumanId ||
    !request.signingCredentialId ||
    !request.receipt
  )
    throw new Error(`Cannot export incomplete ${checkpoint} request`);
  const envelope = parseCheckpointEnvelope(request.message);
  if (envelope.checkpoint !== checkpoint)
    throw new Error(`Request message is not ${checkpoint}`);
  return {
    checkpoint,
    canonicalMessage: request.message,
    request: {
      id: request.id,
      status: 'completed',
      nonce: request.nonce,
      purpose: request.purpose ?? '',
      teamId,
      verificationMethod: HARDWARE_METHOD,
      expiresAt: request.expiresAt,
      completedAt: request.completedAt,
      claimantId: request.claimedByHumanId,
      credentialId: request.signingCredentialId,
      valid: true,
    },
    evidence: request.receipt.value,
  };
}

function parseArtifact(value: unknown): HumanCheckpointProof {
  const artifact = asRecord(value, '$');
  assertExactKeys(
    artifact,
    [
      'format',
      'serviceRequestId',
      'teamId',
      'exportedAt',
      'checkpoints',
      'proofHash',
    ],
    '$',
  );
  if (
    artifact.format !== PROOF_VERSION ||
    artifact.serviceRequestId !== SERVICE_REQUEST_ID ||
    typeof artifact.teamId !== 'string' ||
    !artifact.teamId ||
    typeof artifact.exportedAt !== 'string' ||
    typeof artifact.proofHash !== 'string' ||
    !Array.isArray(artifact.checkpoints) ||
    artifact.checkpoints.length !== 2
  )
    throw new Error('Invalid human-checkpoint-proof:v1 artifact');
  canonicalJson(value);
  return value as HumanCheckpointProof;
}

function verifyCheckpoint(
  checkpoint: ProofCheckpoint,
  teamId: string,
): VerificationCheck {
  const result: VerificationCheck = {
    checkpoint: String(checkpoint?.checkpoint ?? 'unknown'),
    valid: false,
    errors: [],
  };
  try {
    const item = asRecord(checkpoint, '$.checkpoints[]');
    assertExactKeys(
      item,
      ['checkpoint', 'canonicalMessage', 'request', 'evidence'],
      '$.checkpoints[]',
    );
    const envelope = parseCheckpointEnvelope(checkpoint.canonicalMessage);
    if (envelope.checkpoint !== checkpoint.checkpoint)
      fail('checkpoint mismatch');
    if (envelope.teamId !== teamId || checkpoint.request.teamId !== teamId)
      fail('team mismatch');
    if (checkpoint.request.status !== 'completed' || !checkpoint.request.valid)
      fail('request is not valid and completed');
    if (checkpoint.request.verificationMethod !== HARDWARE_METHOD)
      fail('request method mismatch');
    const expectedPurpose = PURPOSES[checkpoint.checkpoint];
    if (checkpoint.request.purpose !== expectedPurpose)
      fail('purpose mismatch');
    verifyEvidence(checkpoint, expectedPurpose);
    result.requestId = checkpoint.request.id;
    result.derivedPublicKey = canonicalJson(
      checkpoint.evidence.derivedPublicKey,
    );
    result.valid = true;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

function verifyEvidence(checkpoint: ProofCheckpoint, purpose: string): void {
  const evidence = checkpoint.evidence;
  const { proofHash, ...withoutEvidenceHash } = evidence;
  if (proofHash !== sha256Base64Url(canonicalBytes(withoutEvidenceHash)))
    fail('evidence proofHash mismatch');
  if (
    evidence.version !== 1 ||
    evidence.operation !== 'signing-request' ||
    evidence.requestId !== checkpoint.request.id ||
    evidence.credentialId !== checkpoint.request.credentialId ||
    evidence.claimantId !== checkpoint.request.claimantId ||
    evidence.teamId !== checkpoint.request.teamId ||
    evidence.verificationMethod !== HARDWARE_METHOD ||
    evidence.nonce !== checkpoint.request.nonce ||
    evidence.purpose !== purpose ||
    evidence.expiresAt !== checkpoint.request.expiresAt
  )
    fail('evidence metadata mismatch');

  const envelopeBytes = fromBase64Url(evidence.envelope, 'evidence envelope');
  const signingEnvelope = asRecord(
    parseCanonicalJson(new TextDecoder().decode(envelopeBytes)),
    '$.evidence.envelope',
  );
  assertExactKeys(
    signingEnvelope,
    [
      'version',
      'audience',
      'operation',
      'requestId',
      'credentialId',
      'verificationMethod',
      'teamId',
      'claimantId',
      'nonce',
      'purpose',
      'expiresAt',
      'signingPayload',
      'publicMaterialHash',
    ],
    '$.evidence.envelope',
  );
  if (
    signingEnvelope.version !== 1 ||
    signingEnvelope.audience !== 'moltnet:preview-sign' ||
    signingEnvelope.operation !== 'signing-request' ||
    signingEnvelope.requestId !== evidence.requestId ||
    signingEnvelope.credentialId !== evidence.credentialId ||
    signingEnvelope.verificationMethod !== HARDWARE_METHOD ||
    signingEnvelope.teamId !== evidence.teamId ||
    signingEnvelope.claimantId !== evidence.claimantId ||
    signingEnvelope.nonce !== evidence.nonce ||
    signingEnvelope.purpose !== evidence.purpose ||
    signingEnvelope.expiresAt !== evidence.expiresAt
  )
    fail('decoded signing envelope mismatch');
  if (typeof signingEnvelope.signingPayload !== 'string')
    fail('missing signing payload');
  const expectedSigningBytes = buildSigningBytes(
    checkpoint.canonicalMessage,
    checkpoint.request.nonce,
  );
  if (
    !Buffer.from(signingEnvelope.signingPayload, 'base64').equals(
      Buffer.from(expectedSigningBytes),
    )
  ) {
    fail('canonical message does not match signed payload');
  }
  if (sha256Base64Url(envelopeBytes) !== evidence.digest)
    fail('message digest mismatch');
  if (
    !verifyP256PrehashedSignature(
      fromBase64Url(evidence.digest, 'evidence digest'),
      fromBase64Url(evidence.signature, 'evidence signature'),
      evidence.derivedPublicKey,
    )
  )
    fail('ESP256 signature invalid');
}

export function buildSigningBytes(message: string, nonce: string): Uint8Array {
  const messageHash = Buffer.from(
    sha256Base64Url(Buffer.from(message)),
    'base64url',
  );
  const prefix = Buffer.from('moltnet:v1');
  const nonceBytes = Buffer.from(nonce);
  const result = Buffer.alloc(
    prefix.length + 4 + messageHash.length + 4 + nonceBytes.length,
  );
  let offset = 0;
  prefix.copy(result, offset);
  offset += prefix.length;
  result.writeUInt32BE(messageHash.length, offset);
  offset += 4;
  messageHash.copy(result, offset);
  offset += messageHash.length;
  result.writeUInt32BE(nonceBytes.length, offset);
  offset += 4;
  nonceBytes.copy(result, offset);
  return result;
}

function fail(message: string): never {
  throw new Error(message);
}
