#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verifyProofArtifact } from './proof.js';
import { proofPathFromArguments } from './verify-proof-args.js';

// pnpm forwards its own `--` separator through each nested run, so the first
// real argument can be preceded by one or more of them.
const path = proofPathFromArguments(process.argv.slice(2));
if (!path) {
  console.error('Usage: verify-proof <human-checkpoint-proof.json>');
  process.exitCode = 2;
} else {
  try {
    const report = verifyProofArtifact(
      JSON.parse(await readFile(path, 'utf8')) as unknown,
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
