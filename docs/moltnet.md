# MoltNet requirements

Everything here is provisioned automatically by `pnpm run setup:local`. This
document exists so you can tell what that script created, reproduce it against
a different MoltNet deployment, or debug an agent that refuses to pick up work.

MoltNet is authoritative for identities, teams, agent tasks, runtime profiles,
signing credentials, and signing requests. The dashboard and Node-RED never
treat their own SQLite cache as proof: every approval is re-fetched from MoltNet
before it can unlock an action.

## Pinned versions

| Package                            | Version | Used for                                 |
| ---------------------------------- | ------- | ---------------------------------------- |
| `@themoltnet/sdk`                  | 0.128.0 | API client for the dashboard and seeding |
| `@themoltnet/agent-daemon`         | 0.36.0  | Task polling, leasing, runtime hosting   |
| `@themoltnet/pi-runtime`           | 0.6.0   | Custom runtime, tool definitions         |
| `@themoltnet/signer`               | 0.2.0   | Loopback HID companion for the YubiKey   |
| `@themoltnet/yubikey-preview-sign` | 0.4.0   | ESP256 / ARKG verification in `core`     |

## Services

| Service           | URL                      | Notes                              |
| ----------------- | ------------------------ | ---------------------------------- |
| MoltNet REST API  | `http://127.0.0.1:8080`  | `HUMAN_CHECKPOINT_MOLTNET_URL`     |
| Ory Hydra public  | `http://localhost:4444`  | OAuth authorize/token/userinfo     |
| Ory Hydra admin   | `http://127.0.0.1:4445`  | Client registration during setup   |
| Ory Kratos public | `http://localhost:4433`  | Login and logout browser flows     |
| Ory Kratos admin  | `http://127.0.0.1:4434`  | Identity creation during setup     |
| Signer companion  | `http://127.0.0.1:17373` | Loopback only; never given cookies |

The MoltNet application images are AMD64, so Docker needs AMD64 emulation on
Apple Silicon. Ory, Postgres, Redis, and the object store run natively.

## Identities and teams

`scripts/bootstrap-local.mjs` creates:

- **One agent identity** with a generated keypair, registered in the `agents`
  table with its public key and fingerprint.
- **One field technician** — owns the YubiKey and makes both decisions.
- **One credential manager** — exists only because MoltNet refuses to let a
  credential owner activate their own credential. This separation is a MoltNet
  rule, not a demo convenience.
- **One team**, with both humans as owners and the agent as a member.
- **One private diary** for the agent.

Keto relation tuples are written for each `Human` self relation and for team
membership. Without them MoltNet authorization denies the task and signing
calls even when the OAuth token is valid.

## OAuth clients

Two separate Hydra clients. The agent never uses the technician's client and
never receives a human token.

**Agent client** — machine-to-machine:

```text
grant_types: client_credentials
auth method:  client_secret_post
scope:        diary:read diary:write crypto:sign agent:profile
              team:read task:read task:write
metadata:     { type: moltnet_agent, identity_id, public_key, fingerprint }
```

The `metadata.type` and `identity_id` are how MoltNet links the OAuth client to
the agent identity. A client without them authenticates but cannot claim tasks.

**Dashboard client** — browser, on behalf of a human:

```text
grant_types:  authorization_code, refresh_token
auth method:  client_secret_post
scope:        openid offline_access human:profile team:read crypto:sign
redirect_uris: http://localhost:1880/dashboard/auth/callback
metadata:     { type: human_checkpoint_dashboard, team_id }
```

`crypto:sign` is what allows the dashboard to create signing requests on the
technician's behalf. The resulting token stays AES-GCM sealed in an HttpOnly
cookie; browser JavaScript never sees it.

## Runtime policy

Created by `packages/dashboard/scripts/seed-runtime-profile.mjs`:

```text
name:  human-checkpoint-field-service-tools-v1
tools: approved_public_source_check, submit_freeform_output
```

This is the model's entire visible tool surface. The seeding script is
idempotent and reconciles drift — if the policy already exists with extra or
missing tools, it adds and removes to match exactly.

## Runtime profile

The profile is the enforcement boundary the agent daemon runs under:

```js
{
  name: `human-checkpoint-field-service-${provider}-${model}`,
  runtimeKind: 'human_checkpoint_pi',
  provider,                                   // HUMAN_CHECKPOINT_MODEL_PROVIDER
  model,                                      // HUMAN_CHECKPOINT_MODEL
  requiredEnv: [providerKeyEnv, 'HUMAN_CHECKPOINT_EXA_API_KEY'],
  requiredTools: ['approved_public_source_check'],
  toolEnforcement: 'enforce',
  leaseTtlSec: 900,
  heartbeatIntervalMs: 15_000,
  maxBatchSize: 4,
  maxTurns: 8,
  maxOutputTokens: 4096,
  sandbox: {
    network: { allowedHosts: ['api.exa.ai'] },
    hostExec: { autoApprove: false },
  },
}
```

The load-bearing fields:

- **`toolEnforcement: 'enforce'`** — the model cannot call a tool outside the
  attached policy. Anything weaker turns the approval gate into a suggestion.
- **`sandbox.network.allowedHosts`** — the agent can reach `api.exa.ai` and
  nothing else. Even a fully compromised prompt cannot exfiltrate to a third
  host.
- **`hostExec.autoApprove: false`** — no unattended shell execution.
- **`requiredEnv`** — the daemon refuses to claim work when the model key or
  the Exa key is missing, instead of failing halfway through a task.
- **`runtimeKind`** — must match the `runtimeKind` declared in the runtime
  module, or the daemon will not accept the profile.

The script prints the created `runtimeProfileId`; `setup-local.mjs` writes it
into `.env.local` as `HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID`.

## Custom runtime

`packages/dashboard/runtime/human-checkpoint-runtime.mjs` declares the runtime
and default-exports a daemon adapter:

```js
const runtime = definePiRuntime({ runtimeKind: 'human_checkpoint_pi', ... });
export default createPiDaemonAdapter(runtime);
```

It defines one tool, `approved_public_source_check`, whose only parameter is a
`signingRequestId`. The tool then:

1. Rejects an ID that does not match the approval recorded on the durable task.
2. Rejects a task belonging to a different team.
3. Re-fetches the signing request from MoltNet.
4. Takes every query, domain, and result limit from the hardware-signed
   canonical message — never from model-supplied arguments.

That last point is the design: the model can name _which_ approval to use, but
cannot influence _what_ it authorizes.

## Running the agent daemon

`pnpm run agent` resolves to:

```bash
node node_modules/@themoltnet/agent-daemon/dist/main.js \
  --runtime packages/dashboard/runtime/human-checkpoint-runtime.mjs \
  poll \
  --agent   "$MOLTNET_AGENT_NAME" \
  --agent-root <repository root> \
  --team    "$HUMAN_CHECKPOINT_TEAM_ID" \
  --profile "$HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID" \
  --task-types freeform
```

`pnpm run start:local` runs this alongside the dashboard and the signer
companion, and stops all three together if any one exits.

## Environment variables

MoltNet and agent-related entries from `.env.example`:

| Variable                               | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `HUMAN_CHECKPOINT_MOLTNET_URL`         | MoltNet REST API base URL                   |
| `MOLTNET_API_URL`                      | Same URL, read by the daemon and signer     |
| `MOLTNET_AGENT_NAME`                   | Agent name the daemon polls as              |
| `HUMAN_CHECKPOINT_TEAM_ID`             | Team scoping every task and signing request |
| `HUMAN_CHECKPOINT_DIARY_ID`            | Agent's private diary                       |
| `HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID`  | Profile the daemon runs under               |
| `HUMAN_CHECKPOINT_AGENT_CLIENT_ID`     | Agent OAuth client                          |
| `HUMAN_CHECKPOINT_AGENT_CLIENT_SECRET` | Agent OAuth secret                          |
| `HUMAN_CHECKPOINT_AGENT_TOKEN_URL`     | Hydra token endpoint for client credentials |
| `HUMAN_CHECKPOINT_HUMAN_CLIENT_ID`     | Dashboard OAuth client                      |
| `HUMAN_CHECKPOINT_HUMAN_CLIENT_SECRET` | Dashboard OAuth secret                      |
| `HUMAN_CHECKPOINT_HUMAN_AUTHORIZE_URL` | Hydra authorize endpoint                    |
| `HUMAN_CHECKPOINT_HUMAN_TOKEN_URL`     | Hydra token endpoint                        |
| `HUMAN_CHECKPOINT_HUMAN_USERINFO_URL`  | Hydra userinfo endpoint                     |
| `HUMAN_CHECKPOINT_HUMAN_LOGOUT_URL`    | Kratos logout, so accounts can be switched  |
| `HUMAN_CHECKPOINT_MODEL_PROVIDER`      | Provider recorded on the runtime profile    |
| `HUMAN_CHECKPOINT_MODEL`               | Model recorded on the runtime profile       |
| `HUMAN_CHECKPOINT_MODEL_API_ENV`       | Name of the env var holding the model key   |
| `OLLAMA_API_KEY`                       | Model credential for the two real tasks     |
| `HUMAN_CHECKPOINT_EXA_API_KEY`         | Exa credential, required by the profile     |
| `HUMAN_CHECKPOINT_SIGNER_URL`          | Loopback signer companion                   |
| `MOLTNET_SIGNER_PORT`                  | Port the companion binds                    |
| `MOLTNET_SIGNER_ALLOWED_ORIGINS`       | Origins the companion accepts               |

`HUMAN_CHECKPOINT_MODEL_API_ENV` is indirection, not duplication: the runtime
profile stores the _name_ of the variable holding the model key, so MoltNet
records which credential is required without ever storing the key.

## Signing credential lifecycle

1. The technician enrolls the YubiKey from **YubiKey setup**. The dashboard
   creates a MoltNet signing credential, and the companion performs the
   enrollment and registration touches.
2. MoltNet leaves the credential `pending_approval`.
3. The technician signs out; the credential manager signs in and activates it.
   MoltNet rejects self-approval, so this second identity is mandatory.
4. The technician signs back in. The credential reports ready and both
   checkpoints become available.

Each later ceremony creates a MoltNet signing request carrying the canonical
message, nonce, purpose, verification method, and expiry. ARKG derives a fresh
public key per request, which is why the two checkpoints show different keys.

## Troubleshooting

**The daemon starts but never claims a task.** Check that the team ID and
profile ID in `.env.local` match what MoltNet returned, that the agent client
metadata carries `identity_id`, and that the Keto team-membership tuple exists.

**Tasks fail immediately with a missing-env error.** The profile's
`requiredEnv` lists the model key variable and `HUMAN_CHECKPOINT_EXA_API_KEY`;
the daemon enforces both before claiming.

**The daemon rejects the profile.** `runtimeKind` in
`human-checkpoint-runtime.mjs` must equal the profile's `runtimeKind`.

**The tool is invisible to the model.** Confirm the runtime policy is attached
to the profile — `seed-runtime-profile.mjs` calls
`runtimeProfiles.setPolicies` on every run, so re-running it repairs this.

**Credential stuck in `pending_approval`.** Activate it from the credential
manager account. The owner cannot approve their own.

Re-running `pnpm run setup:local` is safe: it reuses existing identities, the
team, the diary, and the runtime profile.
