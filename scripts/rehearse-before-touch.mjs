#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const origin = process.env.HUMAN_CHECKPOINT_ORIGIN ?? 'http://localhost:1880';
const signerUrl =
  process.env.HUMAN_CHECKPOINT_SIGNER_URL ?? 'http://127.0.0.1:17373';

const dashboard = await fetch(`${origin}/dashboard/ui/requests`, {
  headers: { accept: 'text/html' },
  redirect: 'manual',
});
if (![200, 302, 303].includes(dashboard.status)) {
  throw new Error(`Dashboard returned HTTP ${dashboard.status}`);
}

const signer = await fetch(`${signerUrl}/health`).catch(() => null);
if (!signer?.ok) throw new Error('The local signer companion is unavailable.');

const flow = JSON.parse(
  await readFile(
    new URL('../packages/dashboard/flows/flows.json', import.meta.url),
    'utf8',
  ),
);
const types = new Set(flow.map((node) => node.type));
for (const type of [
  'ui-base',
  'ui-page',
  'ui-template',
  'human-checkpoint-task-run',
  'human-checkpoint-create',
  'human-checkpoint-release',
]) {
  if (!types.has(type)) throw new Error(`Generated flow is missing ${type}.`);
}
if (types.has('http in') || types.has('http response')) {
  throw new Error('Generated flow still contains the retired journey API.');
}

process.stdout.write(
  `${JSON.stringify(
    {
      dashboard: `${origin}/dashboard/ui/requests`,
      dashboardStatus:
        dashboard.status === 200 ? 'authenticated' : 'authentication-required',
      signerCompanion: 'ready',
      dashboardPages: flow.filter((node) => node.type === 'ui-page').length,
      moltNetTaskBranches: flow.filter(
        (node) => node.type === 'human-checkpoint-task-run',
      ).length,
      hardwareTouchesPerformed: 0,
      next: 'Open the dashboard in Chrome. The script deliberately did not start a workflow or create signing evidence.',
    },
    null,
    2,
  )}\n`,
);
