#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repositoryRoot, '.env.local');
const databasePath = join(
  repositoryRoot,
  '.moltnet',
  'human-checkpoint-demo',
  'human-checkpoint.sqlite',
);

run('docker', [
  'compose',
  '--project-name',
  'human-checkpoint',
  '--env-file',
  'infra/.env',
  '-f',
  'infra/compose.yaml',
  'up',
  '-d',
  '--wait',
]);
run(process.execPath, ['scripts/bootstrap-local.mjs']);
run('pnpm', ['run', 'build']);

const profileResult = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=.env.local',
    'packages/dashboard/scripts/seed-runtime-profile.mjs',
  ],
  {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (profileResult.error) throw profileResult.error;
if (profileResult.status !== 0) {
  throw new Error('Runtime profile seeding failed.');
}
const profile = JSON.parse(profileResult.stdout);
setEnvValue('HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID', profile.runtimeProfileId);

const { HumanCheckpointStore } =
  await import('../packages/store/dist/index.js');
const store = new HumanCheckpointStore(databasePath);
store.seedDemoData();
const supportRequests = store.listSupportRequests();
store.close();

process.stdout.write(
  `${JSON.stringify(
    {
      ready: true,
      teamId: envValue('HUMAN_CHECKPOINT_TEAM_ID'),
      agent: envValue('MOLTNET_AGENT_NAME'),
      runtimeProfileId: profile.runtimeProfileId,
      runtimePolicyId: profile.policyId,
      supportRequests: {
        open: supportRequests.filter((item) => item.status === 'open').length,
        pendingReview: supportRequests.filter(
          (item) => item.status === 'pending-review',
        ).length,
        closed: supportRequests.filter((item) => item.status === 'closed')
          .length,
      },
      technicianCredentials: join(
        repositoryRoot,
        '.moltnet',
        'human-checkpoint-field-agent',
        'dashboard.json',
      ),
      next: 'Run pnpm run start:local',
    },
    null,
    2,
  )}\n`,
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

function setEnvValue(name, value) {
  if (!existsSync(envPath)) throw new Error('Local environment is missing.');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  let replaced = false;
  const next = lines.map((line) => {
    if (!line.startsWith(`${name}=`)) return line;
    replaced = true;
    return `${name}=${value}`;
  });
  if (!replaced) next.push(`${name}=${value}`);
  writeFileSync(envPath, `${next.filter(Boolean).join('\n')}\n`, {
    mode: 0o600,
  });
}

function envValue(name) {
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1) ?? null;
}
