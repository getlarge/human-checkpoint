#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentName = 'human-checkpoint-field-agent';
const agentDir = join(repositoryRoot, '.moltnet', agentName);
const identityPath = join(agentDir, 'moltnet.json');
const dashboardPath = join(agentDir, 'dashboard.json');
const envPath = join(repositoryRoot, '.env.local');
const apiUrl = 'http://127.0.0.1:8080';
const hydraPublicUrl = 'http://localhost:4444';
const hydraAdminUrl = 'http://127.0.0.1:4445';
const kratosAdminUrl = 'http://127.0.0.1:4434';
const ketoWriteUrl = 'http://127.0.0.1:4467';
const dashboardOrigin = 'http://localhost:1880';

await requireHealthy(`${apiUrl}/health`);

const schemas = await requestJson(`${kratosAdminUrl}/schemas`);
const agentSchema = schemas.find((schema) =>
  schema.schema?.$id?.includes('agent'),
);
const humanSchema = schemas.find((schema) =>
  schema.schema?.$id?.includes('human'),
);
if (!agentSchema || !humanSchema) {
  throw new Error('Local Kratos is missing the MoltNet identity schemas.');
}

if (existsSync(identityPath) && existsSync(dashboardPath)) {
  const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
  let dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8'));
  if (
    !identity.oauth2?.client_id ||
    !identity.oauth2?.client_secret ||
    !dashboard.teamId ||
    !dashboard.clientId ||
    !dashboard.clientSecret
  ) {
    throw new Error(
      'Existing local credentials are incomplete. Run pnpm run infra:down with volumes removed, then remove .moltnet and retry.',
    );
  }
  dashboard = await ensureCredentialManager(dashboard, humanSchema.id);
  writeApplicationEnv({ identity, dashboard });
  printSummary(identity, dashboard, true);
  process.exit(0);
}

const keyPair = makeKeyPair();
const identity = await requestJson(`${kratosAdminUrl}/admin/identities`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    schema_id: agentSchema.id,
    traits: {
      public_key: keyPair.publicKey,
      voucher_code: 'human-checkpoint-local-demo',
    },
    credentials: {
      password: {
        config: { password: `hc-agent-${randomBytes(24).toString('hex')}` },
      },
    },
  }),
});

const technicianPassword = `hc-tech-${randomBytes(18).toString('base64url')}`;
const technician = await requestJson(`${kratosAdminUrl}/admin/identities`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    schema_id: humanSchema.id,
    traits: {
      email: 'technician@human-checkpoint.demo.invalid',
      username: 'field-technician',
    },
    credentials: {
      password: { config: { password: technicianPassword } },
    },
  }),
});
const credentialManagerPassword = `hc-manager-${randomBytes(18).toString('base64url')}`;
const credentialManager = await requestJson(
  `${kratosAdminUrl}/admin/identities`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema_id: humanSchema.id,
      traits: {
        email: 'credential-manager@human-checkpoint.demo.invalid',
        username: 'credential-manager',
      },
      credentials: {
        password: { config: { password: credentialManagerPassword } },
      },
    }),
  },
);

const teamId = randomUUID();
const diaryId = randomUUID();
runSql(
  `INSERT INTO agents (identity_id, public_key, fingerprint) VALUES (${sql(identity.id)}, ${sql(keyPair.publicKey)}, ${sql(keyPair.fingerprint)});`,
);
runSql(`INSERT INTO humans (identity_id) VALUES (${sql(technician.id)});`);
runSql(
  `INSERT INTO humans (identity_id) VALUES (${sql(credentialManager.id)});`,
);
runSql(
  `INSERT INTO teams (id, name, status, personal, creator_agent_id) VALUES (${sql(teamId)}, 'Human Checkpoint Field Service', 'active', false, ${sql(identity.id)});`,
);
runSql(
  `INSERT INTO diaries (id, creator_agent_id, team_id, name, visibility) VALUES (${sql(diaryId)}, ${sql(identity.id)}, ${sql(teamId)}, 'Human Checkpoint Demo', 'private');`,
);

await putRelation({
  namespace: 'Agent',
  object: identity.id,
  relation: 'self',
  subject_id: identity.id,
});
await putRelation({
  namespace: 'Human',
  object: technician.id,
  relation: 'self',
  subject_id: technician.id,
});
await putRelation({
  namespace: 'Human',
  object: credentialManager.id,
  relation: 'self',
  subject_id: credentialManager.id,
});
await putRelation({
  namespace: 'Team',
  object: teamId,
  relation: 'owners',
  subject_set: {
    namespace: 'Agent',
    object: identity.id,
    relation: '',
  },
});
await putRelation({
  namespace: 'Team',
  object: teamId,
  relation: 'owners',
  subject_set: {
    namespace: 'Human',
    object: credentialManager.id,
    relation: '',
  },
});
await putRelation({
  namespace: 'Team',
  object: teamId,
  relation: 'owners',
  subject_set: {
    namespace: 'Human',
    object: technician.id,
    relation: '',
  },
});
await putRelation({
  namespace: 'Diary',
  object: diaryId,
  relation: 'team',
  subject_set: { namespace: 'Team', object: teamId, relation: '' },
});

const agentClient = await requestJson(`${hydraAdminUrl}/admin/clients`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Human Checkpoint field-service agent (local)',
    grant_types: ['client_credentials'],
    response_types: [],
    token_endpoint_auth_method: 'client_secret_post',
    scope:
      'diary:read diary:write crypto:sign agent:profile team:read task:read task:write',
    metadata: {
      type: 'moltnet_agent',
      identity_id: identity.id,
      public_key: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
    },
  }),
});

const dashboardClient = await requestJson(`${hydraAdminUrl}/admin/clients`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Human Checkpoint technician dashboard (local)',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    redirect_uris: [`${dashboardOrigin}/dashboard/auth/callback`],
    post_logout_redirect_uris: [`${dashboardOrigin}/dashboard/hardware-setup/`],
    scope: 'openid offline_access human:profile team:read crypto:sign',
    metadata: { type: 'human_checkpoint_dashboard', team_id: teamId },
  }),
});

if (
  !agentClient.client_id ||
  !agentClient.client_secret ||
  !dashboardClient.client_id ||
  !dashboardClient.client_secret
) {
  throw new Error('Hydra did not return the generated client credentials.');
}

const storedIdentity = writeIdentity({
  identity,
  keyPair,
  clientId: agentClient.client_id,
  clientSecret: agentClient.client_secret,
  teamId,
  diaryId,
});
const dashboard = {
  clientId: dashboardClient.client_id,
  clientSecret: dashboardClient.client_secret,
  teamId,
  diaryId,
  technician: {
    id: technician.id,
    username: 'field-technician',
    email: 'technician@human-checkpoint.demo.invalid',
    password: technicianPassword,
  },
  credentialManager: {
    id: credentialManager.id,
    username: 'credential-manager',
    email: 'credential-manager@human-checkpoint.demo.invalid',
    password: credentialManagerPassword,
  },
};
writeFileSync(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`, {
  mode: 0o600,
});
writeApplicationEnv({ identity: storedIdentity, dashboard });
printSummary(storedIdentity, dashboard, false);

function makeKeyPair() {
  const pair = generateKeyPairSync('ed25519');
  const publicBytes = pair.publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const privateBytes = pair.privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .subarray(-32);
  const compact = createHash('sha256')
    .update(publicBytes)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return {
    publicKey: `ed25519:${publicBytes.toString('base64')}`,
    privateKey: privateBytes.toString('base64'),
    fingerprint: compact.match(/.{4}/g).join('-'),
  };
}

function writeIdentity({
  identity,
  keyPair,
  clientId,
  clientSecret,
  teamId,
  diaryId,
}) {
  mkdirSync(join(agentDir, 'ssh'), { recursive: true, mode: 0o700 });
  const sshPrivateKey = join(agentDir, 'ssh', 'id_ed25519');
  execFileSync(
    'ssh-keygen',
    [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      `${agentName}@local`,
      '-f',
      sshPrivateKey,
    ],
    { stdio: 'pipe' },
  );
  const sshPublicKey = `${sshPrivateKey}.pub`;
  writeFileSync(
    join(agentDir, 'ssh', 'allowed_signers'),
    `${agentName}@local ${readFileSync(sshPublicKey, 'utf8').trim()}\n`,
    { mode: 0o644 },
  );
  const gitconfigPath = join(agentDir, 'gitconfig');
  writeFileSync(
    gitconfigPath,
    [
      '[user]',
      `\tname = ${agentName}`,
      `\temail = ${agentName}@local.invalid`,
      `\tsigningKey = ${sshPrivateKey}`,
      '[gpg]',
      '\tformat = ssh',
      '[gpg "ssh"]',
      `\tallowedSignersFile = ${join(agentDir, 'ssh', 'allowed_signers')}`,
      '[commit]',
      '\tgpgsign = true',
      '',
    ].join('\n'),
    { mode: 0o644 },
  );
  const stored = {
    identity_id: identity.id,
    oauth2: { client_id: clientId, client_secret: clientSecret },
    keys: {
      public_key: keyPair.publicKey,
      private_key: keyPair.privateKey,
      fingerprint: keyPair.fingerprint,
    },
    endpoints: { api: apiUrl, mcp: `${apiUrl}/mcp` },
    registered_at: new Date().toISOString(),
    ssh: {
      private_key_path: sshPrivateKey,
      public_key_path: sshPublicKey,
    },
    git: {
      name: agentName,
      email: `${agentName}@local.invalid`,
      signing: true,
      config_path: gitconfigPath,
    },
    profile: { local: true },
  };
  writeFileSync(identityPath, `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    join(agentDir, 'env'),
    [
      `MOLTNET_AGENT_NAME='${agentName}'`,
      `MOLTNET_TEAM_ID='${teamId}'`,
      `MOLTNET_DIARY_ID='${diaryId}'`,
      `MOLTNET_API_URL='${apiUrl}'`,
      `GIT_CONFIG_GLOBAL='${gitconfigPath}'`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  return stored;
}

function writeApplicationEnv({ identity, dashboard }) {
  const gitconfig = join(agentDir, 'gitconfig');
  const diaryId =
    dashboard.diaryId || agentEnvironmentValue('MOLTNET_DIARY_ID');
  if (!diaryId) throw new Error('The local MoltNet diary ID is missing.');
  const values = {
    HUMAN_CHECKPOINT_MOLTNET_URL: apiUrl,
    HUMAN_CHECKPOINT_AGENT_TOKEN_URL: `${hydraPublicUrl}/oauth2/token`,
    HUMAN_CHECKPOINT_AGENT_CLIENT_ID: identity.oauth2.client_id,
    HUMAN_CHECKPOINT_AGENT_CLIENT_SECRET: identity.oauth2.client_secret,
    HUMAN_CHECKPOINT_TEAM_ID: dashboard.teamId,
    HUMAN_CHECKPOINT_DIARY_ID: diaryId,
    HUMAN_CHECKPOINT_HUMAN_AUTHORIZE_URL: `${hydraPublicUrl}/oauth2/auth`,
    HUMAN_CHECKPOINT_HUMAN_TOKEN_URL: `${hydraPublicUrl}/oauth2/token`,
    HUMAN_CHECKPOINT_HUMAN_USERINFO_URL: `${hydraPublicUrl}/userinfo`,
    HUMAN_CHECKPOINT_HUMAN_LOGOUT_URL:
      'http://localhost:4433/self-service/logout/browser?return_to=http%3A%2F%2Flocalhost%3A1880%2Fdashboard%2Fhardware-setup%2F',
    HUMAN_CHECKPOINT_HUMAN_CLIENT_ID: dashboard.clientId,
    HUMAN_CHECKPOINT_HUMAN_CLIENT_SECRET: dashboard.clientSecret,
    HUMAN_CHECKPOINT_COOKIE_SECRET:
      currentEnv().HUMAN_CHECKPOINT_COOKIE_SECRET ||
      randomBytes(32).toString('base64url'),
    HUMAN_CHECKPOINT_NODE_RED_CREDENTIAL_SECRET:
      currentEnv().HUMAN_CHECKPOINT_NODE_RED_CREDENTIAL_SECRET ||
      randomBytes(32).toString('base64url'),
    HUMAN_CHECKPOINT_SIGNER_URL: 'http://127.0.0.1:17373',
    HUMAN_CHECKPOINT_PORT: '1880',
    HUMAN_CHECKPOINT_ORIGIN: dashboardOrigin,
    HUMAN_CHECKPOINT_DEMO_CUSTOMER_ID: 'CUST-NORTH-WATER',
    HUMAN_CHECKPOINT_HYDRA_ADMIN_URL: hydraAdminUrl,
    HUMAN_CHECKPOINT_LOCAL_AUTO_CONSENT: 'true',
    MOLTNET_AGENT_NAME: agentName,
    MOLTNET_API_URL: apiUrl,
    GIT_CONFIG_GLOBAL: gitconfig,
    HUMAN_CHECKPOINT_MODEL_PROVIDER:
      currentEnv().HUMAN_CHECKPOINT_MODEL_PROVIDER || 'ollama-cloud',
    HUMAN_CHECKPOINT_MODEL:
      currentEnv().HUMAN_CHECKPOINT_MODEL || 'gemma4:31b-cloud',
    HUMAN_CHECKPOINT_MODEL_API_ENV:
      currentEnv().HUMAN_CHECKPOINT_MODEL_API_ENV || 'OLLAMA_API_KEY',
    MOLTNET_SIGNER_PORT: '17373',
    MOLTNET_SIGNER_ALLOWED_ORIGINS: dashboardOrigin,
  };
  const inheritedOllama = process.env.OLLAMA_API_KEY;
  const inheritedExa =
    process.env.HUMAN_CHECKPOINT_EXA_API_KEY || process.env.EXA_API_KEY;
  if (inheritedOllama) values.OLLAMA_API_KEY = inheritedOllama;
  if (inheritedExa) values.HUMAN_CHECKPOINT_EXA_API_KEY = inheritedExa;
  writeEnv(values);
}

function agentEnvironmentValue(name) {
  const agentEnvPath = join(agentDir, 'env');
  if (!existsSync(agentEnvPath)) return null;
  const line = readFileSync(agentEnvPath, 'utf8')
    .split('\n')
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).replace(/^['"]|['"]$/g, '');
}

function currentEnv() {
  const values = {};
  if (!existsSync(envPath)) return values;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function writeEnv(values) {
  const existing = existsSync(envPath)
    ? readFileSync(envPath, 'utf8').split('\n')
    : [];
  const pending = new Map(Object.entries(values));
  const next = existing.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=.*/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  for (const [name, value] of pending) next.push(`${name}=${value}`);
  writeFileSync(
    envPath,
    `${next.filter((line, index) => line || index < next.length - 1).join('\n')}\n`,
    { mode: 0o600 },
  );
}

function runSql(statement) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'human-checkpoint',
      '--env-file',
      join(repositoryRoot, 'infra', '.env'),
      '-f',
      join(repositoryRoot, 'infra', 'compose.yaml'),
      'exec',
      '-T',
      'app-db',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'moltnet',
      '-d',
      'moltnet',
      '-c',
      statement,
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Postgres command failed.');
  }
}

function putRelation(body) {
  return requestJson(`${ketoWriteUrl}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function requireHealthy(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`Local MoltNet did not become healthy at ${url}.`);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${url} returned ${response.status}: ${text}`,
    );
  }
  return body;
}

async function ensureCredentialManager(dashboard, humanSchemaId) {
  if (
    dashboard.credentialManager?.id &&
    dashboard.credentialManager?.password
  ) {
    return dashboard;
  }
  const password = `hc-manager-${randomBytes(18).toString('base64url')}`;
  const manager = await requestJson(`${kratosAdminUrl}/admin/identities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schema_id: humanSchemaId,
      traits: {
        email: 'credential-manager@human-checkpoint.demo.invalid',
        username: 'credential-manager',
      },
      credentials: { password: { config: { password } } },
    }),
  });
  runSql(`INSERT INTO humans (identity_id) VALUES (${sql(manager.id)});`);
  await putRelation({
    namespace: 'Human',
    object: manager.id,
    relation: 'self',
    subject_id: manager.id,
  });
  await putRelation({
    namespace: 'Team',
    object: dashboard.teamId,
    relation: 'owners',
    subject_set: {
      namespace: 'Human',
      object: manager.id,
      relation: '',
    },
  });
  const nextDashboard = {
    ...dashboard,
    credentialManager: {
      id: manager.id,
      username: 'credential-manager',
      email: 'credential-manager@human-checkpoint.demo.invalid',
      password,
    },
  };
  writeFileSync(dashboardPath, `${JSON.stringify(nextDashboard, null, 2)}\n`, {
    mode: 0o600,
  });
  return nextDashboard;
}

function printSummary(identity, dashboard, reused) {
  process.stdout.write(
    `${JSON.stringify(
      {
        reused,
        agentName,
        agentIdentityId: identity.identity_id,
        teamId: dashboard.teamId,
        technicianIdentityId: dashboard.technician.id,
        technicianUsername: dashboard.technician.username,
        credentialManagerIdentityId: dashboard.credentialManager?.id,
        credentialManagerUsername: dashboard.credentialManager?.username,
        technicianCredentials: dashboardPath,
        environment: envPath,
      },
      null,
      2,
    )}\n`,
  );
}
