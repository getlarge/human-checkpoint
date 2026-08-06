# User journeys

All application actions stay under the Human Checkpoint origin. Only the
loopback signer-companion approval page opens outside the dashboard.

## Journey 0 — Hardware setup

1. The technician signs in at `/dashboard/ui/hardware-setup`.
2. The browser checks the signer companion with `credentials: omit`.
3. “Enroll YubiKey” opens the enrollment ceremony and hardware touch.
4. The dashboard begins MoltNet registration and sends its challenge to the
   companion for the registration touch.
5. MoltNet creates a pending credential. The technician signs out and the
   seeded credential manager signs in to activate it; MoltNet does not permit
   credential owners to approve their own credential.
6. The field technician signs back in. Ready state shows the credential
   metadata and a route back to the service-request queue.

Unavailable companion, missing or multiple keys, cancelled touch, expired
registration, permission denial, and revoked credential remain recoverable.

## Journey 1 — Claim an assigned request

1. The queue shows open pump request `SR-2048`, open conveyor request `SR-2075`,
   and realistic pending-review and closed history.
2. Opening an assigned request resumes or creates its durable workflow. The
   page explains what accepting it unlocks. No approved history is sent to an
   agent and no AI task has started.
3. On `SR-2075`, the technician can inspect three reported photos loaded from
   the authenticated application. The agent never receives or analyzes their
   pixels; the images do not become findings in the brief.
4. Node-RED locks the request, bounded public query, domains, result limit,
   preparation permission, team, purpose, and expiry.
5. The technician chooses “Claim request with YubiKey” and touches the enrolled
   key.
6. The dashboard completes the decision and re-fetches it from MoltNet.
7. Only after the claim is complete, the first MoltNet task reviews the active
   request and approved same-customer history.
8. A second MoltNet task receives the validated review. Its runtime validates
   state, request ID, team, method, purpose, signature, expiry, and exact
   canonical scope before calling Exa.
9. Results enter a validated technician brief with both task IDs and a source
   trail.

Rejected, expired, missing, wrong-team, wrong-scope, wrong-purpose,
wrong-method, invalid, or non-canonical approval remains blocked.

## Journey 2 — Release the verified work order

1. The technician adds the required append-only field note.
2. The work-order approval binds the brief, field note, fixed disposition,
   team, role, and shift.
3. Bound editing locks; a change requires a fresh request.
4. The same enrolled YubiKey claims and signs the work-order decision.
5. Node-RED re-fetches and re-canonicalizes it before finalization.
6. The page shows both valid signatures and different derived public keys.
7. The technician exports `human-checkpoint-proof:v1` and verifies it offline.
8. A one-character field-note mutation in a copy makes verification fail.

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
