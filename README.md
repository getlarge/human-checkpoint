# Human Checkpoint

**Hardware-bound approvals for AI service workflows**

> The agent can ask. Only a human can answer.

Human Checkpoint is a working field-service demonstration. A technician opens
an assigned support request; a MoltNet agent reviews the request and approved
past service records; and Node-RED keeps the work moving across restarts. The
assistant must stop twice:

1. Before it contacts the approved public sources proposed for this job.
2. Before the completed work order, including the technician's field note, is
   released and the support request is closed.

Both decisions require the same enrolled YubiKey 5.8. Each touch signs the
exact decision shown to the technician and produces a different request-scoped
ARKG public key. The final approval record verifies offline and fails after a
one-character change.

## What the technician sees

- A signed-in queue of open, pending-review, and closed service requests.
- The active request, its asset, and approved same-customer service history.
- Real MoltNet task IDs and current assistant-task status.
- A plain-language summary of the proposed public-source check before touch.
- A generated pre-visit brief that distinguishes prior outcomes from the
  current machine's still-unknown condition.
- A required append-only field note before final approval.
- A downloadable approval record, offline verification, and a safe tamper
  demonstration.

The operator never needs the Node-RED editor or MoltNet Console.

## Architecture

```text
Authenticated technician browser
  /dashboard/requests/ -> assigned support request
             |
             v
Node-RED orchestration + SQLite durable store
  stable workflow id, step checkpoints, append-only events
  MoltNet task links, signing-request links, recovery after restart
             |
             +--> MoltNet task: review request + approved history
             |       |
             |       v
             |    technician approves exact public-source check
             |       |  loopback signer -> same YubiKey
             |       v
             +--> MoltNet task: prepare technician brief
             |       |
             |       +--> runtime tool re-fetches hardware approval
             |            and calls Exa with signed scope only
             |
             +--> technician adds field note and approves release
                     |  loopback signer -> same YubiKey
                     v
                  request closes + offline approval record
```

Node-RED is the process orchestrator. SQLite at
`.moltnet/human-checkpoint-demo/human-checkpoint.sqlite` stores support
requests, workflow instances, idempotent step results, task attempts, approval
links, and an append-only event journal. It provides Absurd-like durability
without adding Absurd to this standalone demo.

MoltNet remains authoritative for task attempts and signing requests. On a
refresh or restart, the dashboard reconstructs its view from SQLite, re-fetches
each linked MoltNet approval, and resumes an existing task ID instead of
silently creating a duplicate.

### Local packages

- `@human-checkpoint/store` — SQLite schema, realistic request history,
  idempotent steps, linked tasks/approvals, and recovery snapshots.
- `@human-checkpoint/core` — canonical decision envelopes, authoritative
  hardware-approval gates, proof export, and offline ESP256 verification.
- `@human-checkpoint/node-red` — direct Node-RED nodes for task creation and
  recovery, signing requests, final release, proof handling, auth routes, and
  the same-origin signing proxy.
- `@human-checkpoint/dashboard` — authenticated request queue, technician UI,
  Node-RED flow, custom MoltNet agent runtime, and profile seeding scripts.

All packages are private workspace packages. The core and store packages are
used directly by the Node-RED package; nothing is published during the demo.

## Security boundary

- Every application page and API, including `http://localhost:1880/`, is behind
  the Human Checkpoint OIDC/team-membership middleware. The Node-RED editor is
  disabled. Missing auth configuration fails closed with HTTP 503.
- Human OAuth tokens stay AES-GCM sealed in an HttpOnly, SameSite cookie.
  Browser JavaScript receives no bearer or refresh token.
- The signing proxy has an exact method/path allowlist, injects team and bearer
  headers server-side, requires same-origin JSON mutations, caps bodies at 64
  KiB, and returns `Cache-Control: no-store`.
- Browser calls to the local signer use `credentials: omit`; MoltNet cookies and
  headers never reach the HID companion.
- The model-visible public-source tool accepts only a MoltNet signing-request
  ID. It re-fetches the request and derives queries, domains, and result count
  only from its canonical hardware-signed message.
- Before Exa, the runtime validates completed state, exact request ID, team,
  hardware method, purpose, MoltNet proof verdict, canonical encoding,
  checkpoint identity, and policy expiry. Returned URLs must also be HTTPS and
  within the approved domains.
- Final release re-fetches the completed request and re-validates the exact
  brief, field note, role, shift, team, purpose, method, and signature.
- Offline verification checks both ESP256 signatures, request-scoped public
  keys, canonical messages, digests, metadata consistency, and aggregate proof
  hash.

The evidence may retain claimant and credential identifiers. This is
request-scoped key separation and exact-byte accountability—not anonymous or
fully unlinkable signing.

## Requirements

- Node.js 22.19 or newer (Node 24 recommended) and pnpm 10.29.3.
- Docker with AMD64 emulation enabled. The pinned MoltNet application images
  are AMD64; Ory, Postgres, Redis, and the object store run natively where
  available.
- Ollama Cloud and Exa API credentials for the two real agent tasks.
- `@themoltnet/signer` 0.2.0 and one compatible YubiKey 5.8 advertising the
  previewSign extension.

Pinned application dependencies include Node-RED 5.0.1,
`@themoltnet/sdk` 0.128.0, `@themoltnet/agent-daemon` 0.36.0,
`@themoltnet/pi-runtime` 0.6.0, TypeScript 5.9.2, and Vitest 3.2.4.

## Local setup

The local setup is self-contained in this repository. It starts pinned
MoltNet, Ory, Postgres, Redis, and object-store services; creates one agent, one
field technician, and one credential manager; creates their team and private
diary; registers separate agent and dashboard OAuth clients; creates the
enforce-mode runtime profile; and seeds the support-request queue.

1. Install dependencies and provide the two external-service keys:

   ```bash
   pnpm install --frozen-lockfile
   export OLLAMA_API_KEY='your-local-key'
   export EXA_API_KEY='your-local-key'
   ```

2. Provision the complete local environment:

   ```bash
   pnpm run setup:local
   ```

   Generated secrets stay in ignored `.env.local` and
   `.moltnet/human-checkpoint-field-agent/`. The technician and credential
   manager usernames and passwords are stored with mode `0600` in
   `dashboard.json` there.

3. Start the dashboard, real task worker, and signer companion together:

   ```bash
   pnpm run start:local
   ```

4. Open `http://localhost:1880/`. Sign in as the field technician and enroll
   the YubiKey from “YubiKey setup”. Sign out and sign in once as the seeded
   credential manager to activate it. Return to the field technician account
   before opening `SR-2048`. MoltNet deliberately prevents the credential
   owner from self-approving this activation.

`pnpm run infra:down` stops the local containers without removing their
volumes. `pnpm run setup:local` is idempotent and reuses the generated
identities and runtime profile.

For a non-hardware smoke test, `pnpm run rehearse:before-touch` performs a
local-only OIDC login through the loopback Hydra admin API, starts `SR-2048`,
waits for the real request-review task, validates its artifact, creates the
exact signing request, and stops before touching or claiming the YubiKey. It is
a development rehearsal only and never produces or substitutes hardware
evidence.

## Demo procedure

1. Show the authenticated queue, including open `SR-2048`, one request pending
   review, and closed past requests.
2. Open `SR-2048`. “Prepare source check for review” creates a real MoltNet
   request-review task; its ID appears under Assistant work.
3. Review the generated public-equipment queries, approved domains, reason, and
   five-minute expiry. Touch the enrolled YubiKey to approve this exact check.
4. The second MoltNet task starts. Its runtime tool re-fetches the approval,
   performs the signed Exa scope, and produces the technician brief.
5. Add the required field note, review the final work order, and touch the same
   YubiKey to approve release.
6. Release the order. `SR-2048` moves to the closed queue and the durable
   workflow remains inspectable.
7. Download and verify the approval record, then run the one-character tamper
   demonstration and show verification fail.

## Verification

```bash
pnpm run check
pnpm run build
pnpm run verify-proof -- .moltnet/human-checkpoint-demo/human-checkpoint-proof.json
```

Automated coverage includes canonical rejection, proxy allowlisting and token
non-disclosure, auth fail-closed behavior, customer-scoped history, durable
restart/retry semantics, denial before approval, wrong request/team/scope/
method/purpose failures, final exact-message binding, real ESP256 verification,
different derived keys, and one-character tampering.

Real hardware remains an operator acceptance gate. Never replace a failed
YubiKey ceremony with mocked evidence in a submitted demo.

## Honest limitations

- previewSign is a Yubico firmware-preview extension, not generic WebAuthn or
  PIV signing. Firmware 5.8 alone does not prove that a key supports it.
- The local seed includes a second human credential manager because MoltNet
  enforces separation between credential ownership and activation. The two
  work decisions still belong to the field technician and use the same
  physical YubiKey.
- SQLite is appropriate for this single-server demonstration. Multi-instance
  production orchestration would need coordinated storage and leasing.
- MoltNet, the model provider, Exa, and the signer ceremony require their
  respective services. Only final proof verification is offline.
- A valid signature proves the exact approval ceremony; it does not certify the
  maintenance decision or make AI-generated guidance correct.
- All service requests and equipment details are synthetic demo content.

## YubiKey 5.8 learnings

- Capability detection matters more than a firmware-version string: the signer
  must confirm previewSign and refuse ambiguous multi-device selection.
- ARKG lets MoltNet fix the decision and prepare verification material before
  the private hardware operation occurs.
- “Sign this JSON” is not a sufficient protocol. Canonical bytes, nonce,
  signing envelope, digest, prehash behavior, method ID, purpose, and expiry all
  need explicit binding.
- Five-minute decisions make cancellation, expiry, and fresh-request recovery
  part of the security UX, not edge-case polish.

## Demo and source links

- Submission form:
  <https://docs.google.com/forms/d/e/1FAIpQLSfaczYBBIYY9p3nJDQCmFmpZ0s8cHuhCbV8QP8I-mw5aOYI6A/viewform>
- Demo video: `TODO: final public URL`
- Permanent source: <https://github.com/getlarge/human-checkpoint/tree/v0.1.0>
- Tagged source archive:
  <https://github.com/getlarge/human-checkpoint/archive/refs/tags/v0.1.0.zip>

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
