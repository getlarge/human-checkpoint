import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const agentName = required('MOLTNET_AGENT_NAME');
const teamId = required('HUMAN_CHECKPOINT_TEAM_ID');
const profileId = required('HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID');
const cli = fileURLToPath(
  new URL(
    '../node_modules/@themoltnet/agent-daemon/dist/main.js',
    import.meta.url,
  ),
);
const runtime = fileURLToPath(
  new URL('../runtime/human-checkpoint-runtime.mjs', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const child = spawn(
  process.execPath,
  [
    cli,
    '--runtime',
    runtime,
    'poll',
    '--agent',
    agentName,
    '--agent-root',
    repositoryRoot,
    '--team',
    teamId,
    '--profile',
    profileId,
    '--task-types',
    'freeform',
  ],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
