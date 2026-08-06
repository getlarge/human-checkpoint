import { describe, expect, it } from 'vitest';

import { proofPathFromArguments } from './verify-proof-args.js';

describe('offline verifier arguments', () => {
  it('ignores separators forwarded through nested pnpm commands', () => {
    expect(
      proofPathFromArguments([
        '--',
        '--',
        '.moltnet/human-checkpoint-demo/human-checkpoint-proof.json',
      ]),
    ).toBe('.moltnet/human-checkpoint-demo/human-checkpoint-proof.json');
  });

  it('reports no proof path when only separators are present', () => {
    expect(proofPathFromArguments(['--'])).toBeUndefined();
  });
});
