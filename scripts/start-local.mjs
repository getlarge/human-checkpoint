#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repositoryRoot, '.env.local');
if (!existsSync(envPath)) {
  throw new Error('Run pnpm run setup:local before starting the demo.');
}

const localEnv = parseEnv(readFileSync(envPath, 'utf8'));
for (const required of [
  'HUMAN_CHECKPOINT_TEAM_ID',
  'HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID',
  'HUMAN_CHECKPOINT_AGENT_CLIENT_ID',
  'HUMAN_CHECKPOINT_HUMAN_CLIENT_ID',
  'HUMAN_CHECKPOINT_COOKIE_SECRET',
  'GIT_CONFIG_GLOBAL',
  'OLLAMA_API_KEY',
  'HUMAN_CHECKPOINT_EXA_API_KEY',
]) {
  if (!localEnv[required] && !process.env[required]) {
    throw new Error(`${required} is required. Run setup again with it set.`);
  }
}

const children = [
  start('dashboard', ['run', 'dashboard']),
  start('agent', ['run', 'agent']),
  start('signer', ['run', 'signer']),
];
let stopping = false;

for (const child of children) {
  child.process.on('exit', (code, signal) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(
      `[${child.name}] exited (${signal || code || 0}); stopping local services.\n`,
    );
    stopChildren();
    process.exitCode = code || 1;
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stopChildren(signal);
  });
}

function start(name, args) {
  const child = spawn('pnpm', args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...localEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => prefix(name, chunk, process.stdout));
  child.stderr.on('data', (chunk) => prefix(name, chunk, process.stderr));
  return { name, process: child };
}

function stopChildren(signal = 'SIGTERM') {
  for (const child of children) {
    if (child.process.exitCode === null) child.process.kill(signal);
  }
}

function prefix(name, chunk, stream) {
  const lines = String(chunk).split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line && index === lines.length - 1) continue;
    stream.write(`[${name}] ${line}\n`);
  }
}

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}
