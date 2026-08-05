export const CHECKPOINT_VERSION = 'human-checkpoint:v1' as const;
export const PROOF_VERSION = 'human-checkpoint-proof:v1' as const;
export const SERVICE_REQUEST_ID = 'SR-2048' as const;
export const HARDWARE_METHOD = 'human-hardware-previewsign' as const;

export type CheckpointName = 'research-authorization' | 'field-release';

export interface CheckpointEnvelope {
  v: typeof CHECKPOINT_VERSION;
  checkpoint: CheckpointName;
  serviceRequestId: typeof SERVICE_REQUEST_ID;
  teamId: string;
  payload: Record<string, unknown>;
}

export interface ResearchAuthorizationPayload extends Record<string, unknown> {
  externalTool: 'exa';
  queries: string[];
  allowedDomains: string[];
  maxResults: number;
  reason: string;
  authorizationExpiresAt: string;
}

export interface FieldReleasePayload extends Record<string, unknown> {
  brief: Record<string, unknown>;
  fieldAmendment: string;
  disposition: 'accepted-with-field-amendment';
  role: string;
  shift: string;
}

export interface Esp256PublicKey {
  kty: 2;
  algorithm: -9;
  curve: 1;
  x: string;
  y: string;
}

export interface PreviewSignEvidence {
  version: 1;
  operation: 'signing-request';
  requestId: string;
  credentialId: string;
  teamId: string;
  claimantId: string;
  verificationMethod: typeof HARDWARE_METHOD;
  nonce: string;
  purpose: string;
  expiresAt: string;
  envelope: string;
  digest: string;
  additionalArgumentsHash: string;
  derivedPublicKey: Esp256PublicKey;
  signature: string;
  proofHash: string;
}

export interface SigningRequestView {
  id: string;
  status: 'pending' | 'claimed' | 'completed' | 'rejected' | 'expired';
  message: string;
  nonce: string;
  purpose: string | null;
  teamId: string | null;
  verificationMethod: 'agent-ed25519' | typeof HARDWARE_METHOD;
  expiresAt: string;
  completedAt: string | null;
  claimedByHumanId: string | null;
  signingCredentialId: string | null;
  valid: boolean | null;
  receipt: {
    verificationMethod: typeof HARDWARE_METHOD;
    value: PreviewSignEvidence;
  } | null;
}

export interface ExportedRequestMetadata {
  id: string;
  status: 'completed';
  nonce: string;
  purpose: string;
  teamId: string;
  verificationMethod: typeof HARDWARE_METHOD;
  expiresAt: string;
  completedAt: string;
  claimantId: string;
  credentialId: string;
  valid: true;
}

export interface ProofCheckpoint {
  checkpoint: CheckpointName;
  canonicalMessage: string;
  request: ExportedRequestMetadata;
  evidence: PreviewSignEvidence;
}

export interface HumanCheckpointProof {
  format: typeof PROOF_VERSION;
  serviceRequestId: typeof SERVICE_REQUEST_ID;
  teamId: string;
  exportedAt: string;
  checkpoints: [ProofCheckpoint, ProofCheckpoint];
  proofHash: string;
}
