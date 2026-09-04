#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const origin = process.env.HUMAN_CHECKPOINT_ORIGIN ?? 'http://localhost:1880';
const signerUrl =
  process.env.HUMAN_CHECKPOINT_SIGNER_URL ?? 'http://127.0.0.1:17373';

const dashboard = await fetch(`${origin}/dashboard/ui/requests`, {
  headers: { accept: 'text/html' },
  redirect: 'manual',
});
if (![200, 302, 303, 401].includes(dashboard.status)) {
  throw new Error(`Dashboard returned HTTP ${dashboard.status}`);
}

const signer = await fetch(`${signerUrl}/health`).catch(() => null);
if (process.env.HUMAN_CHECKPOINT_REQUIRE_SIGNER === 'true' && !signer?.ok) {
  throw new Error('The local signer companion is unavailable.');
}

const consoleUrl =
  process.env.HUMAN_CHECKPOINT_CONSOLE_ORIGIN ?? 'http://localhost:5174';
const console = await fetch(consoleUrl, { redirect: 'manual' }).catch(
  () => null,
);
if (!console?.ok) throw new Error('The local MoltNet Console is unavailable.');

const daemon = await fetch('http://127.0.0.1:17374/health').catch(() => null);
if (!daemon?.ok)
  throw new Error('The paired local Console daemon is unavailable.');

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
process.stdout.write(
  `${JSON.stringify(
    {
      dashboard: `${origin}/dashboard/ui/requests`,
      dashboardStatus:
        dashboard.status === 200 ? 'authenticated' : 'authentication-required',
      signerCompanion: signer?.ok ? 'ready' : 'not started (no-touch tour)',
      console: consoleUrl,
      consoleDaemon: 'ready (human_checkpoint_pi is locally registered)',
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
