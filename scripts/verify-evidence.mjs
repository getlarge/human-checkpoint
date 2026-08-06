#!/usr/bin/env node
// Judge-facing verification of the committed hardware evidence bundle.
//
// This needs Node and the built core package only: no YubiKey, no Docker,
// no MoltNet, no API keys, no network. It checks the three claims the
// submission actually makes about the recorded ceremony.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { verifyProofArtifact } = await import(
  new URL('../packages/core/dist/proof.js', import.meta.url).href
);

const path =
  process.argv.slice(2).find((value) => value !== '--') ??
  fileURLToPath(
    new URL('../docs/evidence/human-checkpoint-proof.json', import.meta.url),
  );

const artifact = JSON.parse(await readFile(path, 'utf8'));
const report = verifyProofArtifact(artifact);

// The tamper check mutates one character in a *copy*. The committed record is
// never rewritten, which is the same guarantee the dashboard gives the operator.
const tampered = JSON.parse(JSON.stringify(artifact));
const release = tampered.checkpoints.find(
  (checkpoint) => checkpoint.checkpoint === 'field-release',
);
const offset = release.canonicalMessage.indexOf('drive-end');
if (offset < 0) throw new Error('Expected field note text was not found.');
release.canonicalMessage =
  release.canonicalMessage.slice(0, offset) +
  'Drive-end' +
  release.canonicalMessage.slice(offset + 'drive-end'.length);
const tamperReport = verifyProofArtifact(tampered);

const keys = report.checkpoints.map(
  (checkpoint) => checkpoint.derivedPublicKey,
);
const claims = [
  ['Both YubiKey signatures verify offline', report.valid],
  ['Each decision used a different request-scoped key', report.keysDiffer],
  ['A one-character field-note change is rejected', !tamperReport.valid],
];

process.stdout.write(`\nHuman Checkpoint — offline evidence check\n`);
process.stdout.write(`record: ${path}\n`);
process.stdout.write(`service request: ${artifact.serviceRequestId}\n`);
process.stdout.write(`exported: ${artifact.exportedAt}\n\n`);

for (const [label, passed] of claims) {
  process.stdout.write(`  ${passed ? '✓' : '✕'} ${label}\n`);
}

process.stdout.write(`\nrequest-scoped public keys\n`);
for (const [index, checkpoint] of report.checkpoints.entries()) {
  const key = keys[index] ? JSON.parse(keys[index]).x : '(unavailable)';
  process.stdout.write(`  ${checkpoint.checkpoint.padEnd(24)} ${key}\n`);
}

if (!tamperReport.valid) {
  const failed = tamperReport.checkpoints.find(
    (checkpoint) => !checkpoint.valid,
  );
  process.stdout.write(
    `\ntamper check rejected the altered copy: ${failed?.errors[0] ?? 'invalid'}\n`,
  );
}

const ok = claims.every(([, passed]) => passed);
process.stdout.write(`\n${ok ? 'PASS' : 'FAIL'}\n\n`);
if (!ok) process.exitCode = 1;
