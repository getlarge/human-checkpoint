#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verifyProofArtifact } from './proof.js';

const path = process.argv[2];
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
