#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const DEMO_REQUEST_IDS = ['SR-2048', 'SR-2075'];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedDatabasePath = join(
  repositoryRoot,
  '.moltnet',
  'human-checkpoint-demo',
  'human-checkpoint.sqlite',
);

const requestIds = parseRequestIds(process.argv.slice(2));
const databasePath = resolve(
  process.env.HUMAN_CHECKPOINT_DATABASE_PATH ?? expectedDatabasePath,
);

assertDemoDatabasePath(databasePath);

const backupDirectory = join(dirname(databasePath), 'backups');
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const backupPath = nextBackupPath(backupDirectory);
const database = new DatabaseSync(databasePath);

try {
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  assertDemoSchema(database, requestIds);

  // VACUUM INTO produces a consistent standalone copy, including WAL state.
  database.exec(`VACUUM INTO '${escapeSqlString(backupPath)}'`);

  const workflowCount = Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM workflow_instances
         WHERE support_request_id IN (${placeholders(requestIds)})`,
      )
      .get(...requestIds).count,
  );

  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        `DELETE FROM workflow_instances
         WHERE support_request_id IN (${placeholders(requestIds)})`,
      )
      .run(...requestIds);
    database
      .prepare(
        `UPDATE support_requests
         SET status = 'open',
             closed_at = NULL,
             confirmed_resolution = NULL,
             approved_for_reuse = 0
         WHERE id IN (${placeholders(requestIds)})`,
      )
      .run(...requestIds);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  assertResetState(database, requestIds);

  process.stdout.write(
    `${JSON.stringify(
      {
        reset: true,
        requests: requestIds,
        workflowsRemoved: workflowCount,
        backup: relative(repositoryRoot, backupPath),
        preserved: [
          'MoltNet identities and team membership',
          'YubiKey credential enrollment and activation',
          'agent runtime profiles',
          'seeded request details, history, and attachments',
        ],
        next: 'Start or restart the demo with pnpm run start:local.',
      },
      null,
      2,
    )}\n`,
  );
} finally {
  database.close();
}

function parseRequestIds(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      [
        'Usage: pnpm run demo:reset [-- SR-2048|SR-2075]',
        '',
        'Without an ID, resets both seeded demo requests.',
        'The command backs up the local demo database before changing it.',
        '',
      ].join('\n'),
    );
    process.exit(0);
  }
  if (args.length > 1 || args.some((arg) => !DEMO_REQUEST_IDS.includes(arg))) {
    throw new Error(
      `Expected no argument or one of: ${DEMO_REQUEST_IDS.join(', ')}.`,
    );
  }
  return args.length === 1 ? args : DEMO_REQUEST_IDS;
}

function assertDemoDatabasePath(candidate) {
  if (candidate !== expectedDatabasePath) {
    throw new Error(
      `Refusing to reset ${candidate}. The demo reset may target only ${expectedDatabasePath}.`,
    );
  }
  if (!existsSync(candidate)) {
    throw new Error(
      `Demo database not found at ${candidate}. Run pnpm run setup:local first.`,
    );
  }
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      'The Human Checkpoint demo database must be a regular file.',
    );
  }
  const realRepositoryRoot = realpathSync(repositoryRoot);
  const realDatabasePath = realpathSync(candidate);
  const expectedRealPath = join(
    realRepositoryRoot,
    '.moltnet',
    'human-checkpoint-demo',
    'human-checkpoint.sqlite',
  );
  if (
    realDatabasePath !== expectedRealPath ||
    !realDatabasePath.startsWith(`${realRepositoryRoot}${sep}`)
  ) {
    throw new Error('Refusing to reset a database outside this repository.');
  }
}

function assertDemoSchema(database, requestIds) {
  const tables = new Set(
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('support_requests', 'workflow_instances')`,
      )
      .all()
      .map((row) => row.name),
  );
  if (!tables.has('support_requests') || !tables.has('workflow_instances')) {
    throw new Error('The target is not a Human Checkpoint workflow database.');
  }
  const present = new Set(
    database
      .prepare(
        `SELECT id FROM support_requests
         WHERE id IN (${placeholders(requestIds)})`,
      )
      .all(...requestIds)
      .map((row) => row.id),
  );
  const missing = requestIds.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(`Seeded demo request not found: ${missing.join(', ')}.`);
  }
}

function assertResetState(database, requestIds) {
  const workflows = Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM workflow_instances
         WHERE support_request_id IN (${placeholders(requestIds)})`,
      )
      .get(...requestIds).count,
  );
  const openRequests = Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM support_requests
         WHERE id IN (${placeholders(requestIds)})
           AND status = 'open'
           AND closed_at IS NULL
           AND confirmed_resolution IS NULL
           AND approved_for_reuse = 0`,
      )
      .get(...requestIds).count,
  );
  if (workflows !== 0 || openRequests !== requestIds.length) {
    throw new Error(
      'Demo reset validation failed. Restore the reported backup.',
    );
  }
}

function nextBackupPath(directory) {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  let candidate = join(
    directory,
    `human-checkpoint-before-reset-${timestamp}.sqlite`,
  );
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = join(
      directory,
      `human-checkpoint-before-reset-${timestamp}-${suffix}.sqlite`,
    );
    suffix += 1;
  }
  return candidate;
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function escapeSqlString(value) {
  return value.replaceAll("'", "''");
}
