import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const runtime = resolve(packageRoot, 'runtime/human-checkpoint-runtime.mjs');
const stateRoot = resolve(
  repositoryRoot,
  '.moltnet/human-checkpoint-console-agent',
);

if (!existsSync(runtime))
  throw new Error(`Runtime module is missing: ${runtime}`);

const env = {
  ...process.env,
  MOLTNET_AGENT_SERVER_ALLOWED_ORIGINS: 'http://localhost:5174',
  MOLTNET_AGENT_SERVER_PORT: '17374',
  MOLTNET_AGENT_SERVER_ROOT: stateRoot,
  MOLTNET_API_URL:
    process.env.HUMAN_CHECKPOINT_MOLTNET_URL ?? 'http://127.0.0.1:8080',
};

const registration = spawnSync(
  'moltnet-agent',
  [
    'runtime',
    'register',
    'human_checkpoint_pi',
    runtime,
  ],
  { cwd: repositoryRoot, env, stdio: 'inherit' },
);
if (registration.error) throw registration.error;
if (registration.status !== 0) process.exit(registration.status ?? 1);

const server = spawn('moltnet-agent', ['server'], {
  cwd: repositoryRoot,
  env,
  stdio: 'inherit',
});
server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
