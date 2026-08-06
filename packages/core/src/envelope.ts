import {
  asRecord,
  assertExactKeys,
  canonicalJson,
  parseCanonicalJson,
} from './canonical.js';
import {
  CHECKPOINT_VERSION,
  type CheckpointEnvelope,
  type CheckpointName,
  type FieldReleasePayload,
  type ResearchAuthorizationPayload,
} from './types.js';

const ENVELOPE_KEYS = [
  'v',
  'checkpoint',
  'serviceRequestId',
  'teamId',
  'payload',
] as const;

export function createCheckpointEnvelope(
  checkpoint: 'research-authorization',
  serviceRequestId: string,
  teamId: string,
  payload: ResearchAuthorizationPayload,
): { envelope: CheckpointEnvelope; canonicalMessage: string };
export function createCheckpointEnvelope(
  checkpoint: 'field-release',
  serviceRequestId: string,
  teamId: string,
  payload: FieldReleasePayload,
): { envelope: CheckpointEnvelope; canonicalMessage: string };
export function createCheckpointEnvelope(
  checkpoint: CheckpointName,
  serviceRequestId: string,
  teamId: string,
  payload: Record<string, unknown>,
) {
  const envelope: CheckpointEnvelope = {
    v: CHECKPOINT_VERSION,
    checkpoint,
    serviceRequestId,
    teamId,
    payload,
  };
  validateCheckpointEnvelope(envelope);
  return { envelope, canonicalMessage: canonicalJson(envelope) };
}

export function parseCheckpointEnvelope(message: string): CheckpointEnvelope {
  const envelope = parseCanonicalJson(message);
  validateCheckpointEnvelope(envelope);
  return envelope;
}

export function validateCheckpointEnvelope(
  value: unknown,
): asserts value is CheckpointEnvelope {
  const envelope = asRecord(value, '$');
  assertExactKeys(envelope, ENVELOPE_KEYS, '$');
  if (
    envelope.v !== CHECKPOINT_VERSION ||
    typeof envelope.serviceRequestId !== 'string' ||
    !/^SR-[0-9]{3,12}$/.test(envelope.serviceRequestId) ||
    typeof envelope.teamId !== 'string' ||
    envelope.teamId.length === 0
  )
    throw new Error('Invalid Human Checkpoint envelope identity');
  const payload = asRecord(envelope.payload, '$.payload');
  if (envelope.checkpoint === 'research-authorization')
    validateResearchPayload(payload);
  else if (envelope.checkpoint === 'field-release')
    validateReleasePayload(payload);
  else throw new Error('Unsupported Human Checkpoint checkpoint');
}

function validateResearchPayload(
  payload: Record<string, unknown>,
): asserts payload is ResearchAuthorizationPayload {
  assertExactKeys(
    payload,
    [
      'externalTool',
      'queries',
      'allowedDomains',
      'maxResults',
      'reason',
      'authorizationExpiresAt',
    ],
    '$.payload',
  );
  if (
    payload.externalTool !== 'exa' ||
    !isNonEmptyStrings(payload.queries) ||
    !isStrings(payload.allowedDomains) ||
    !Number.isInteger(payload.maxResults) ||
    (payload.maxResults as number) < 1 ||
    (payload.maxResults as number) > 10 ||
    typeof payload.reason !== 'string' ||
    !payload.reason ||
    !isIsoInstant(payload.authorizationExpiresAt)
  )
    throw new Error('Invalid research-authorization payload');
}

function validateReleasePayload(
  payload: Record<string, unknown>,
): asserts payload is FieldReleasePayload {
  assertExactKeys(
    payload,
    ['brief', 'fieldAmendment', 'disposition', 'role', 'shift'],
    '$.payload',
  );
  asRecord(payload.brief, '$.payload.brief');
  if (
    typeof payload.fieldAmendment !== 'string' ||
    !payload.fieldAmendment.trim() ||
    payload.disposition !== 'accepted-with-field-amendment' ||
    typeof payload.role !== 'string' ||
    !payload.role ||
    typeof payload.shift !== 'string' ||
    !payload.shift
  )
    throw new Error('Invalid field-release payload');
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
function isNonEmptyStrings(value: unknown): value is string[] {
  return isStrings(value) && value.length > 0 && value.every(Boolean);
}
function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
