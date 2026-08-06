import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

describe('dashboard artifact', () => {
  it('keeps all application UI in FlowFuse Dashboard templates', async () => {
    const flows = JSON.parse(
      await readFile(resolve(root, 'flows/flows.json'), 'utf8'),
    ) as Array<{
      id?: string;
      type?: string;
      path?: string;
      wires?: string[][];
    }>;
    expect(flows.filter((node) => node.type === 'ui-page')).toHaveLength(3);
    expect(flows.filter((node) => node.type === 'ui-group')).toHaveLength(3);
    expect(flows.filter((node) => node.type === 'ui-template')).toHaveLength(3);
    expect(flows.filter((node) => node.type === 'http in')).toHaveLength(2);
    expect(flows.filter((node) => node.type === 'http response')).toHaveLength(
      1,
    );
    expect(flows.find((node) => node.type === 'ui-base')?.path).toBe(
      '/dashboard/ui',
    );
    expect(
      flows.find((node) => node.id === 'hc-technician-template')?.wires,
    ).toEqual([]);
  });

  it('keeps YubiKey ceremonies browser-local and tokens out of templates', async () => {
    const [briefing, setup] = await Promise.all([
      readFile(resolve(root, 'templates/technician-workspace.html'), 'utf8'),
      readFile(resolve(root, 'templates/hardware-setup.html'), 'utf8'),
    ]);
    const source = `${briefing}\n${setup}`;
    expect(source).toContain("credentials: 'omit'");
    expect(source).toContain("'x-moltnet-signer-session': this.token");
    expect(source).not.toContain('authorization: `Bearer ${this.token}`');
    expect(source).toContain('/dashboard/api/signing');
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it('uses technician-facing request and approval language', async () => {
    const [briefing, setup] = await Promise.all([
      readFile(resolve(root, 'templates/technician-workspace.html'), 'utf8'),
      readFile(resolve(root, 'templates/hardware-setup.html'), 'utf8'),
    ]);
    expect(briefing).toContain('Claim request with YubiKey');
    expect(briefing).toContain('MoltNet agent activity');
    expect(briefing).toContain('Questions for the site visit');
    expect(briefing).toContain('Reported evidence');
    expect(briefing).toMatch(/not analyzed by the\s+agent/);
    expect(briefing).toContain('Open full size');
    expect(briefing).toContain('Field note');
    expect(briefing).not.toContain('Field amendment');
    expect(setup).toContain('View assigned requests');
    expect(setup).not.toContain('Service request SR-2048');
    expect(setup).not.toContain('Technical setup details');
    expect(setup).not.toContain('Why two touches');
    expect(setup).toContain('Activate as credential manager');
    expect(setup).toContain(
      'The person who enrolled this YubiKey cannot activate it.',
    );
    expect(briefing).toContain('request.attachments');
    expect(briefing).toContain('Verifying what the technician approved');
    expect(briefing).toContain('Build and verify approval record');
    expect(briefing).toContain('Download verified record');
    expect(briefing).toContain('Change one character and verify again');
    expect(briefing).toContain(
      'Same enrolled YubiKey, two different action keys',
    );
    expect(briefing).toContain('Inspect signatures and offline receipts');
    expect(briefing).toContain('not a second-factor login receipt');
    expect(briefing).toContain('Request-scoped key');
    expect(briefing).toContain('{{ task.taskId }}');
    expect(briefing).not.toMatch(/\bS1\b|\bS2\b/);
  });

  it('keeps manager receipts technical while making verification outcomes explicit', async () => {
    const briefing = await readFile(
      resolve(root, 'templates/technician-workspace.html'),
      'utf8',
    );
    expect(briefing).toContain('Team manager');
    expect(briefing).toContain('Signature and exact signed bytes verified');
    expect(briefing).toContain('Offline verification failed');
    expect(briefing).toContain('Proof hash verified');
    expect(briefing).toContain('request-scoped keys');
    expect(briefing).toContain('one character in a copy of the field');
    expect(briefing).toContain('The released work order is not modified.');
    expect(briefing).toContain('Tamper detected');
    expect(briefing).toContain('verifiedReceiptCount');
    expect(briefing).toContain('verification.checkpoints');
  });

  it('sanitizes approval scope display and does not resurrect a completed claim', async () => {
    const briefing = await readFile(
      resolve(root, 'templates/technician-workspace.html'),
      'utf8',
    );
    expect(briefing).toContain('safeTextList');
    expect(briefing).toContain('safeDomain');
    expect(briefing).toContain(':href="domain.url"');
    expect(briefing).not.toContain('scope.queries.join(');
    expect(briefing).not.toContain('scope.allowedDomains.join(');
    expect(briefing).toContain("approvalStatus === 'not-requested'");
    expect(briefing).toContain('!this.briefReady &&');
    expect(briefing).toContain("this.journey.workflow.state === 'released'");
    expect(briefing).toContain('await this.ensureProof()');
  });

  it('keeps request headings and empty task messages in natural sentence case', async () => {
    const briefing = await readFile(
      resolve(root, 'templates/technician-workspace.html'),
      'utf8',
    );
    expect(briefing).toContain('<b v-if="showAssetId">');
    expect(briefing).toContain('!name.includes(id)');
    expect(briefing).toContain('No agent task has started.');
    expect(briefing).not.toMatch(/\.empty\s*{[^}]*text-transform/s);
  });

  it('exposes the Node-RED editor read-only under the dashboard session', async () => {
    const settings = await readFile(resolve(root, 'settings.cjs'), 'utf8');
    expect(settings).toContain("httpAdminRoot: '/dashboard/node-red'");
    expect(settings).toContain('httpAdminMiddleware: auth.middleware');
    expect(settings).toContain('createReadOnlyNodeRedAdminAuth()');
    expect(settings).toContain("name: 'hc_node_red_session'");
    const strategy = await readFile(
      resolve(root, 'node-red-session-auth.cjs'),
      'utf8',
    );
    expect(strategy).toContain("type: 'strategy'");
    expect(strategy).toContain('autoLogin: true');
    expect(strategy).toContain("permissions: 'read'");
    expect(strategy).not.toContain('password');
  });

  it('auto-authenticates Node-RED only from a validated dashboard session', () => {
    const { HumanCheckpointSessionStrategy } = require(
      resolve(root, 'node-red-session-auth.cjs'),
    );
    const strategy = new HumanCheckpointSessionStrategy(
      {},
      (
        profile: { username: string },
        done: (error: null, user: unknown) => void,
      ) => done(null, { username: profile.username, permissions: 'read' }),
    );
    let authenticated;
    let rejected;
    strategy.success = (user: unknown) => {
      authenticated = user;
    };
    strategy.fail = (reason: unknown) => {
      rejected = reason;
    };
    strategy.error = (error: unknown) => {
      rejected = error;
    };

    strategy.authenticate({
      humanCheckpointSession: { accessToken: 'sealed' },
    });

    expect(authenticated).toEqual({
      username: 'human-checkpoint-team-member',
      permissions: 'read',
    });
    expect(rejected).toBeUndefined();

    authenticated = undefined;
    strategy.authenticate({});
    expect(authenticated).toBeUndefined();
    expect(rejected).toBeInstanceOf(Error);
  });

  it('uses durable Node-RED orchestration and real MoltNet task nodes', async () => {
    const editorDefinitions = await readFile(
      resolve(root, '../node-red/human-checkpoint.html'),
      'utf8',
    );
    const flows = JSON.parse(
      await readFile(resolve(root, 'flows/flows.json'), 'utf8'),
    ) as Array<{
      id?: string;
      type?: string;
      name?: string;
      url?: string;
      taskRole?: string;
      func?: string;
      wires?: string[][];
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
    for (const type of [
      'human-checkpoint-workflow-load',
      'human-checkpoint-task-run',
      'human-checkpoint-workflow-transition',
      'human-checkpoint-journey-view',
    ])
      expect(editorDefinitions).toContain(`registerType('${type}'`);
    expect(
      flows.filter((node) => node.type === 'human-checkpoint-task-run'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskRole: 'request-review' }),
        expect.objectContaining({ taskRole: 'technician-brief' }),
      ]),
    );
    for (const task of flows.filter(
      (node) => node.type === 'human-checkpoint-task-run',
    )) {
      expect(task.wires).toHaveLength(2);
      expect(task.wires?.[1]).toEqual([]);
    }
    expect(types.has('ui-template')).toBe(true);
    expect(types.has('link in')).toBe(true);
    expect(types.has('link out')).toBe(true);
    expect(types.has('comment')).toBe(true);
    expect(types.has('human-checkpoint-request-list')).toBe(true);
    expect(types.has('human-checkpoint-request-start')).toBe(true);
    expect(flows.find((node) => node.id === 'request-start')?.wires).toEqual([
      ['hc-requests-template'],
    ]);
    expect(
      flows.filter((node) => node.type === 'http in').map((node) => node.url),
    ).toEqual(['/dashboard/api/workflow', '/dashboard/api/workflow/action']);
    expect(
      flows.find((node) => node.id === 'dashboard-action-router')?.wires,
    ).toEqual([
      ['route-claim-request-out'],
      ['route-prepare-brief-out'],
      ['route-request-release-out'],
      ['route-finalize-release-out'],
      ['route-build-proof-out'],
      ['route-verify-proof-out'],
    ]);
    expect(flows.find((node) => node.id === 'flow-title')?.name).toContain(
      'durable service-request workflow',
    );
    for (const id of ['build-review-task', 'build-brief-task']) {
      const taskBuilder = flows.find((node) => node.id === id)?.func;
      expect(taskBuilder).toContain('omit proposedTaskType and verification');
      expect(taskBuilder).toContain('attachments: _reportedAttachments');
      expect(taskBuilder).toContain('value: requestContext');
    }
    const actionInput = flows.find(
      (node) => node.id === 'dashboard-api-action-input',
    )?.func;
    expect(actionInput).toContain('Same-origin request required.');
    expect(actionInput).toContain('Workflow action is too large.');
    expect(actionInput).toContain('allowedActions');
    expect(actionInput).toContain('Unknown workflow action.');
    expect(
      flows.find((node) => node.id === 'dashboard-journey-output')?.func,
    ).toContain("'cache-control': 'no-store'");
  });

  it('starts history review and brief preparation only after a verified request claim', async () => {
    const flows = JSON.parse(
      await readFile(resolve(root, 'flows/flows.json'), 'utf8'),
    ) as Array<{
      id?: string;
      type?: string;
      func?: string;
      wires?: string[][];
    }>;
    const byId = (id: string) => flows.find((node) => node.id === id);

    expect(byId('source-prepare-load')?.wires).toEqual([
      ['build-request-claim'],
      [],
    ]);
    expect(byId('build-request-claim')?.wires).toEqual([
      ['create-source-approval'],
    ]);
    expect(byId('build-request-claim')?.func).not.toContain(
      'msg.reusableHistory',
    );
    expect(byId('brief-run-load')?.wires).toEqual([['load-claim-link'], []]);
    expect(byId('claim-authoritative-get')?.wires).toEqual([
      ['verify-completed-claim'],
    ]);
    expect(byId('verify-completed-claim')?.func).toContain(
      "claim?.status !== 'completed'",
    );
    expect(byId('verify-completed-claim')?.func).toContain(
      'claim?.valid !== true',
    );
    expect(byId('verify-completed-claim')?.wires).toEqual([['claim-complete']]);
    expect(byId('claim-complete')?.wires).toEqual([['build-review-task']]);
    expect(byId('build-review-task')?.func).toContain(
      'The technician has signed the request claim.',
    );
    expect(byId('build-review-task')?.func).toContain('msg.reusableHistory');
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

  it('serves SQLite-backed request photographs only through the authenticated Node-RED route', async () => {
    const routes = await readFile(
      resolve(root, '../node-red/src/http-routes.ts'),
      'utf8',
    );
    const queue = await readFile(
      resolve(root, 'templates/request-queue.html'),
      'utf8',
    );
    expect(routes).toContain("'/dashboard/api/attachments/:id'");
    expect(routes).toContain("'cache-control', 'no-store'");
    expect(routes).toContain("'x-content-type-options', 'nosniff'");
    expect(routes).toContain('getSupportRequestAttachment(id)');
    expect(queue).toContain('Demo service team');
    expect(queue).toContain('reported photos');
    expect(queue).toContain('not analyzed by the agent');
  });

  it('provides keyboard focus, responsive layout, and reduced motion', async () => {
    const templates = await Promise.all(
      ['request-queue', 'hardware-setup', 'technician-workspace'].map((name) =>
        readFile(resolve(root, `templates/${name}.html`), 'utf8'),
      ),
    );
    for (const template of templates) {
      expect(template).toContain(':focus-visible');
      expect(template).toContain('@media');
      expect(template).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });
});
