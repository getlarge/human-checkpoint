import { parseCheckpointEnvelope } from './envelope.js';
import { HARDWARE_METHOD, } from './types.js';
export class CheckpointDeniedError extends Error {
    reason;
    constructor(reason) {
        super(`Checkpoint denied: ${reason}`);
        this.reason = reason;
        this.name = 'CheckpointDeniedError';
    }
}
export function assertApprovedCheckpoint(request, expected) {
    if (!request)
        deny('missing_request');
    if (request.id !== expected.requestId)
        deny('wrong_request');
    if (request.status !== 'completed')
        deny(`status_${request.status}`);
    if (request.teamId !== expected.teamId)
        deny('wrong_team');
    if (request.verificationMethod !== HARDWARE_METHOD)
        deny('wrong_method');
    if (request.purpose !== expected.purpose)
        deny('wrong_purpose');
    if (request.valid !== true || !request.receipt)
        deny('proof_invalid');
    if (request.message !== expected.canonicalMessage)
        deny('wrong_message');
    if (request.completedAt === null)
        deny('missing_completion');
    const envelope = parseCheckpointEnvelope(request.message);
    if (envelope.checkpoint !== expected.checkpoint)
        deny('wrong_checkpoint');
    if (envelope.teamId !== expected.teamId)
        deny('wrong_envelope_team');
    if (expected.checkpoint === 'research-authorization') {
        const expiresAt = new Date(envelope.payload.authorizationExpiresAt);
        if (expiresAt <= (expected.now ?? new Date()))
            deny('authorization_expired');
    }
    return envelope;
}
export async function runAuthorizedResearch(input) {
    const envelope = assertApprovedCheckpoint(input.request, input.expected);
    return input.invoke(envelope.payload);
}
export function amendmentIsLocked(status) {
    return status === 'pending' || status === 'claimed' || status === 'completed';
}
function deny(reason) {
    throw new CheckpointDeniedError(reason);
}
