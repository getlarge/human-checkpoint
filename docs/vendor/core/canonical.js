import { Buffer } from './buffer-shim.js';
import { createHash } from './node-crypto-shim.js';
const encoder = new TextEncoder();
export class CanonicalError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'CanonicalError';
    }
}
export function canonicalJson(value) {
    assertJsonValue(value, '$');
    return encode(value);
}
export function canonicalBytes(value) {
    return encoder.encode(canonicalJson(value));
}
export function sha256Base64Url(value) {
    return createHash('sha256').update(value).digest('base64url');
}
export function parseCanonicalJson(text) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        throw new CanonicalError('invalid_value', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (canonicalJson(value) !== text) {
        throw new CanonicalError('not_canonical', 'JSON text is not the canonical encoding of its content');
    }
    return value;
}
export function assertExactKeys(value, expected, path) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length ||
        actual.some((key, index) => key !== wanted[index])) {
        throw new CanonicalError('invalid_envelope', `${path} has unknown or missing fields (expected ${wanted.join(', ')})`);
    }
}
export function asRecord(value, path) {
    if (value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null)) {
        throw new CanonicalError('invalid_value', `${path} must be a plain object`);
    }
    return value;
}
function assertJsonValue(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new CanonicalError('invalid_value', `${path} must be finite`);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!(index in value)) {
                throw new CanonicalError('invalid_value', `${path}[${index}] is an array hole`);
            }
            assertJsonValue(value[index], `${path}[${index}]`);
        }
        return;
    }
    if (typeof value === 'object') {
        for (const [key, child] of Object.entries(asRecord(value, path))) {
            assertJsonValue(child, `${path}.${key}`);
        }
        return;
    }
    throw new CanonicalError('invalid_value', `${path} cannot contain ${typeof value}`);
}
function encode(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'number')
        return JSON.stringify(value);
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (Array.isArray(value))
        return `[${value.map((child) => encode(child)).join(',')}]`;
    const entries = Object.entries(value).sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(',')}}`;
}
