#!/usr/bin/env node
// Vendors the compiled authorization gate into docs/vendor/core so the GitHub
// Pages explainer can call the real `assertApprovedCheckpoint` instead of a
// re-implementation.
//
// The gate path is pure synchronous logic. `createHash` is reachable only from
// `sha256Base64Url`, which the gate never calls, so the shim below exists to
// satisfy the import and throws loudly if that ever stops being true.

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const from = new URL('packages/core/dist/', root);
const to = new URL('docs/vendor/core/', root);

const MODULES = ['gate.js', 'envelope.js', 'canonical.js', 'types.js'];

await mkdir(fileURLToPath(to), { recursive: true });

await writeFile(
  fileURLToPath(new URL('node-crypto-shim.js', to)),
  `// Stand-in for node:crypto in the browser. The gate path never hashes; if
// this throws, the vendored module set needs a real Web Crypto implementation.
export function createHash() {
  throw new Error(
    'createHash is not available in the browser build. The gate path must not hash.',
  );
}
`,
);

// `canonicalJson` sorts object keys by UTF-8 bytes using Buffer. These two
// operations have exact browser equivalents, so key ordering stays identical.
await writeFile(
  fileURLToPath(new URL('buffer-shim.js', to)),
  `const encoder = new TextEncoder();
export const Buffer = {
  from(value) {
    return typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  },
  compare(left, right) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  },
};
`,
);

let rewritten = 0;
for (const name of MODULES) {
  const source = await readFile(new URL(name, from), 'utf8');
  let patched = source.replace(/from ['"]node:crypto['"]/g, () => {
    rewritten += 1;
    return `from './node-crypto-shim.js'`;
  });
  if (/\bBuffer\b/.test(patched)) {
    patched = `import { Buffer } from './buffer-shim.js';\n${patched}`;
    rewritten += 1;
  }
  await writeFile(fileURLToPath(new URL(name, to)), patched);
}

await copyFile(
  fileURLToPath(new URL('docs/evidence/human-checkpoint-proof.json', root)),
  fileURLToPath(new URL('docs/vendor/human-checkpoint-proof.json', root)),
);

process.stdout.write(
  `vendored ${MODULES.length} modules to docs/vendor/core (${rewritten} import rewrite${rewritten === 1 ? '' : 's'})\n`,
);
