import { describe, expect, it } from 'vitest';

import { isBriefRecoveryEligible, normalizeTaskResult } from './nodes.js';

describe('normalizeTaskResult', () => {
  it('normalizes scalar brief fields and preserves the raw agent artifact', () => {
    const rawBody = {
      findings: 'A grounded public-source finding.',
      questionsToCheck: ['Question one?', 'Question two?'],
      unknowns: ['Maintenance history is unknown.'],
    };

    expect(
      normalizeTaskResult('technician-brief', {
        accepted: true,
        artifactBody: rawBody,
      }),
    ).toEqual({
      changed: true,
      result: {
        accepted: true,
        artifactBodyRaw: rawBody,
        artifactBody: {
          ...rawBody,
          findings: ['A grounded public-source finding.'],
        },
      },
    });
  });

  it('normalizes keyed brief findings and preserves the raw agent artifact', () => {
    const rawBody = {
      findings: {
        historicalContext: 'Relevant approved service history.',
        documentation: 'Grounded manufacturer guidance.',
      },
      questionsToCheck: ['Question one?', 'Question two?'],
      unknowns: ['The cause remains unknown.'],
    };

    expect(
      normalizeTaskResult('technician-brief', {
        accepted: true,
        artifactBody: rawBody,
      }),
    ).toEqual({
      changed: true,
      result: {
        accepted: true,
        artifactBodyRaw: rawBody,
        artifactBody: {
          ...rawBody,
          findings: [
            'Relevant approved service history.',
            'Grounded manufacturer guidance.',
          ],
        },
      },
    });
  });

  it('normalizes nested brief findings into readable bullets', () => {
    const rawBody = {
      findings: {
        assetDetails: {
          assetId: 'CV-204',
          model: 'Dorner 2100 Series End Drive',
          manual: 'MAN-DORNER-2100-REV-J',
        },
        historicalComparisons: [
          {
            id: 'SR-1872',
            summary: 'Belt drifted after washdown.',
            confirmedResolution: 'Residue was removed from the spindle.',
          },
          {
            id: 'SR-1938',
            summary: 'Tracking changed after relocation.',
            confirmedResolution: 'The frame was realigned.',
          },
        ],
      },
      questionsToCheck: ['Question one?', 'Question two?'],
      unknowns: ['The cause remains unknown.'],
    };

    const normalized = normalizeTaskResult('technician-brief', {
      accepted: true,
      artifactBody: rawBody,
    });

    expect(normalized.changed).toBe(true);
    expect(
      (normalized.result as { artifactBody: { findings: string[] } })
        .artifactBody.findings,
    ).toEqual([
      'CV-204 · Dorner 2100 Series End Drive · MAN-DORNER-2100-REV-J',
      'SR-1872 — Belt drifted after washdown. — Residue was removed from the spindle.',
      'SR-1938 — Tracking changed after relocation. — The frame was realigned.',
    ]);
  });

  it('leaves request-review results unchanged', () => {
    const result = { artifactBody: { findings: 'A finding.' } };

    expect(normalizeTaskResult('request-review', result)).toEqual({
      changed: false,
      result,
    });
  });

  it('recovers only a completed approval with an exact grounded brief', () => {
    const input = {
      requestId: 'SR-2048',
      approval: {
        status: 'completed',
        requestId: 'approval-1',
        scope: { allowedDomains: ['skf.com', 'pumps.org'] },
      },
      brief: {
        grounded: true,
        requestId: 'SR-2048',
        approvalRequestId: 'approval-1',
        findings: ['Relevant public guidance.'],
        questionsToCheck: ['Question one?', 'Question two?'],
        unknowns: ['Maintenance history is unknown.'],
        sources: [{ url: 'https://www.skf.com/example' }],
      },
    };

    expect(isBriefRecoveryEligible(input)).toBe(true);
    expect(
      isBriefRecoveryEligible({
        ...input,
        brief: {
          ...input.brief,
          sources: [{ url: 'https://example.com/outside-policy' }],
        },
      }),
    ).toBe(false);
    expect(
      isBriefRecoveryEligible({
        ...input,
        approval: { ...input.approval, status: 'pending' },
      }),
    ).toBe(false);
  });
});
