import { asRecord, assertExactKeys, canonicalJson, parseCanonicalJson, } from './canonical.js';
import { CHECKPOINT_VERSION, } from './types.js';
const ENVELOPE_KEYS = [
    'v',
    'checkpoint',
    'serviceRequestId',
    'teamId',
    'payload',
];
export function createCheckpointEnvelope(checkpoint, serviceRequestId, teamId, payload) {
    const envelope = {
        v: CHECKPOINT_VERSION,
        checkpoint,
        serviceRequestId,
        teamId,
        payload,
    };
    validateCheckpointEnvelope(envelope);
    return { envelope, canonicalMessage: canonicalJson(envelope) };
}
export function parseCheckpointEnvelope(message) {
    const envelope = parseCanonicalJson(message);
    validateCheckpointEnvelope(envelope);
    return envelope;
}
export function validateCheckpointEnvelope(value) {
    const envelope = asRecord(value, '$');
    assertExactKeys(envelope, ENVELOPE_KEYS, '$');
    if (envelope.v !== CHECKPOINT_VERSION ||
        typeof envelope.serviceRequestId !== 'string' ||
        !/^SR-[0-9]{3,12}$/.test(envelope.serviceRequestId) ||
        typeof envelope.teamId !== 'string' ||
        envelope.teamId.length === 0)
        throw new Error('Invalid Human Checkpoint envelope identity');
    const payload = asRecord(envelope.payload, '$.payload');
    if (envelope.checkpoint === 'research-authorization')
        validateResearchPayload(payload);
    else if (envelope.checkpoint === 'field-release')
        validateReleasePayload(payload);
    else
        throw new Error('Unsupported Human Checkpoint checkpoint');
}
function validateResearchPayload(payload) {
    assertExactKeys(payload, [
        'externalTool',
        'queries',
        'allowedDomains',
        'maxResults',
        'reason',
        'authorizationExpiresAt',
    ], '$.payload');
    if (payload.externalTool !== 'exa' ||
        !isNonEmptyStrings(payload.queries) ||
        !isStrings(payload.allowedDomains) ||
        !Number.isInteger(payload.maxResults) ||
        payload.maxResults < 1 ||
        payload.maxResults > 10 ||
        typeof payload.reason !== 'string' ||
        !payload.reason ||
        !isIsoInstant(payload.authorizationExpiresAt))
        throw new Error('Invalid research-authorization payload');
}
function validateReleasePayload(payload) {
    assertExactKeys(payload, ['brief', 'fieldAmendment', 'disposition', 'role', 'shift'], '$.payload');
    asRecord(payload.brief, '$.payload.brief');
    if (typeof payload.fieldAmendment !== 'string' ||
        !payload.fieldAmendment.trim() ||
        payload.disposition !== 'accepted-with-field-amendment' ||
        typeof payload.role !== 'string' ||
        !payload.role ||
        typeof payload.shift !== 'string' ||
        !payload.shift)
        throw new Error('Invalid field-release payload');
}
function isStrings(value) {
    return (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}
function isNonEmptyStrings(value) {
    return isStrings(value) && value.length > 0 && value.every(Boolean);
}
function isIsoInstant(value) {
    if (typeof value !== 'string')
        return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
