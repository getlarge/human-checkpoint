# User journeys

All application actions stay under the Human Checkpoint origin. Only the
loopback signer-companion approval page opens outside the dashboard.

## Journey 0 — Hardware setup

1. The technician signs in at `/dashboard/hardware-setup`.
2. The browser checks the signer companion with `credentials: omit`.
3. “Enroll YubiKey” opens the enrollment ceremony and hardware touch.
4. The dashboard begins MoltNet registration and sends its challenge to the
   companion for the registration touch.
5. MoltNet creates a pending credential; the seeded team owner activates it.
6. Ready state shows the credential metadata and route to `SR-2048`.

Unavailable companion, missing or multiple keys, cancelled touch, expired
registration, permission denial, and revoked credential remain recoverable.

## Journey 1 — Approve a public-source check

1. Opening `SR-2048` resumes or creates its durable workflow.
2. A real MoltNet task reviews the active request and approved same-customer
   service history, then proposes public-equipment queries while Exa remains
   blocked.
3. Preparing the technician decision locks the exact queries, domains, result
   limit, reason, team, purpose, and expiry.
4. The technician claims and touches the enrolled YubiKey.
5. The dashboard completes the decision and re-fetches it from MoltNet.
6. A second MoltNet task starts. Its runtime validates state, request ID, team,
   method, purpose, signature, expiry, and exact canonical scope before calling
   Exa.
7. Results enter a validated technician brief with the task ID and source
   trail.

Rejected, expired, missing, wrong-team, wrong-scope, wrong-purpose,
wrong-method, invalid, or non-canonical approval remains blocked.

## Journey 2 — Release the verified work order

1. The technician adds the required append-only field amendment.
2. The work-order approval binds the brief, amendment, fixed disposition,
   team, role, and shift.
3. Bound editing locks; a change requires a fresh request.
4. The same enrolled YubiKey claims and signs the work-order decision.
5. Node-RED re-fetches and re-canonicalizes it before finalization.
6. The page shows both valid signatures and different derived public keys.
7. The technician exports `human-checkpoint-proof:v1` and verifies it offline.
8. A one-character amendment mutation in a copy makes verification fail.

## Restart recovery

Node-RED persists support requests, stable workflow IDs, idempotent step
results, task attempts, signing-request links, and append-only events in SQLite
under `.moltnet/human-checkpoint-demo`. On refresh it re-fetches known MoltNet
tasks and approvals. Cached completion can never unlock a public-source call or
release.

## Keyboard path

Native links, buttons, inputs, and `details` disclosures support the full flow.
Async status is announced, focus is visible, and errors return focus to a useful
recovery action.
