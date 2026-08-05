import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('dashboard artifact', () => {
  it.each(['requests', 'hardware-setup', 'technician-briefing'])(
    '%s has the required accessible page structure',
    async (route) => {
      const html = await readFile(
        resolve(root, `public/${route}/index.html`),
        'utf8',
      );
      expect(html).toContain('<html lang="en">');
      expect(html).toMatch(/class="skip-link/);
      expect(html).toMatch(/<nav[^>]+aria-label=/);
      expect(html).toMatch(/<main id="main"/);
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).toMatch(/role="(?:status|alert)"/);
      expect(html).not.toMatch(/onclick=|href="#"/);
    },
  );

  it('calls the loopback signer with credentials omitted', async () => {
    const source = await readFile(resolve(root, 'public/app.js'), 'utf8');
    expect(source).toContain("credentials: 'omit'");
    expect(source).toContain("'x-moltnet-signer-session': this.token");
    expect(source).not.toContain('authorization: `Bearer ${this.token}`');
    expect(source).toContain('/dashboard/api/signing');
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it('uses operator-facing approval language and explains activation separation', async () => {
    const [briefing, setup, source] = await Promise.all([
      readFile(resolve(root, 'public/technician-briefing/index.html'), 'utf8'),
      readFile(resolve(root, 'public/hardware-setup/index.html'), 'utf8'),
      readFile(resolve(root, 'public/app.js'), 'utf8'),
    ]);
    expect(briefing).toContain('Approve source check with YubiKey');
    expect(briefing).toContain('Field note');
    expect(briefing).not.toContain('Field amendment');
    expect(setup).toContain('different team credential manager');
    expect(setup).toContain('Activate as credential manager');
    expect(source).toContain(
      'The person who enrolled this YubiKey cannot activate it.',
    );
    expect(source).toContain('work order released');
  });

  it('uses durable Node-RED orchestration and real MoltNet task nodes', async () => {
    const flows = JSON.parse(
      await readFile(resolve(root, 'flows/flows.json'), 'utf8'),
    ) as Array<{
      id?: string;
      type?: string;
      url?: string;
      taskRole?: string;
      func?: string;
    }>;
    const types = new Set(flows.map((node) => node.type));
    for (const type of [
      'human-checkpoint-create',
      'human-checkpoint-get',
      'human-checkpoint-release',
      'human-checkpoint-proof',
      'human-checkpoint-verify-proof',
      'human-checkpoint-workflow-load',
      'human-checkpoint-task-run',
      'human-checkpoint-workflow-transition',
      'human-checkpoint-journey-view',
    ]) {
      expect(types.has(type)).toBe(true);
    }
    expect(
      flows.filter((node) => node.type === 'human-checkpoint-task-run'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskRole: 'request-review' }),
        expect.objectContaining({ taskRole: 'technician-brief' }),
      ]),
    );
    expect(
      flows.some((node) => node.url === '/dashboard/api/journey/research/run'),
    ).toBe(true);
    expect(
      flows.some(
        (node) => node.url === '/dashboard/api/journey/release/finalize',
      ),
    ).toBe(true);
    for (const id of ['build-review-task', 'build-brief-task']) {
      expect(flows.find((node) => node.id === id)?.func).toContain(
        'omit proposedTaskType and verification',
      );
    }
  });

  it('exposes only the approval request id to the agent research tool', async () => {
    const runtime = await readFile(
      resolve(root, 'runtime/human-checkpoint-runtime.mjs'),
      'utf8',
    );
    expect(runtime).toContain("name: 'approved_public_source_check'");
    expect(runtime).toContain('runAuthorizedResearch');
    expect(runtime).toContain(
      'agent.crypto.signingRequests.get(signingRequestId)',
    );
    expect(runtime).toContain(
      'const expectedRequestId = approvalIdFromTask(claimedTask.task)',
    );
    expect(
      runtime.indexOf(
        'const expectedRequestId = approvalIdFromTask(claimedTask.task)',
      ),
    ).toBeGreaterThan(runtime.indexOf('async execute'));
    expect(runtime).toContain('signingRequestId !== expectedRequestId');
    expect(runtime).toContain('claimedTask.task.teamId !== teamId');
    const parameterBlock = runtime.slice(
      runtime.indexOf('parameters: Type.Object'),
      runtime.indexOf('const publicSourceTool'),
    );
    expect(parameterBlock).toContain('signingRequestId');
    expect(parameterBlock).not.toMatch(
      /\bqueries\b|\ballowedDomains\b|\bmaxResults\b/,
    );
  });

  it('exposes reduced-motion and narrow-screen rules', async () => {
    const css = await readFile(resolve(root, 'public/app.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain(':focus-visible');
    const definitions = new Set(
      [...css.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]),
    );
    const references = [...css.matchAll(/var\((--[a-z-]+)(?:,|\))/g)].map(
      (match) => match[1],
    );
    expect(references.filter((token) => !definitions.has(token))).toEqual([]);
  });
});
