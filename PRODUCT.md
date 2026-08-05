# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a field technician supervising an AI-prepared service job
under time pressure. They need to understand exactly what the agent wants to do,
reserve consequential decisions for themselves, and leave evidence that can be
checked away from MoltNet. The evaluation audience is a technical hackathon
judge who needs to see one physical YubiKey approve two distinct decisions.

## Product Purpose

Human Checkpoint demonstrates a field-service workflow in which an AI agent may
review an assigned request, use approved service history, and prepare a work
order. It cannot contact public sources or release that work order until a
technician reviews the proposed action and touches the same enrolled YubiKey
5.8.

Success is one coherent `SR-2048` demonstration: the technician sees real
MoltNet assistant tasks; the source check is denied before hardware approval;
the brief and field note cannot be released without a second approval; the two
request-scoped public keys differ; and an offline proof fails after a
one-character field-note mutation.

## Positioning

Human Checkpoint puts hardware approval inside an agent action boundary, not
only at sign-in. MoltNet fixes the request, team, method, purpose, expiry, and
evidence; YubiKey ARKG derives a distinct action key for each ceremony without
exposing private key material.

Tagline: **The agent can ask. Only a human can answer.**

## Operating Context

- One enrolled YubiKey and a seeded technician acting as demo team owner.
- An authenticated queue at `/dashboard/requests`, YubiKey setup, and an
  assigned-request workspace.
- A loopback signer companion for explicit confirmation and hardware touch.
- MoltNet for identities, agent tasks, runtime profiles, credentials, signing
  requests, and authoritative security state; Node-RED for orchestration and a
  server-side SQLite workflow journal.
- A synthetic industrial-pump service request, `SR-2048`.

## Capabilities and Constraints

- The public-source decision binds the exact queries, domains, result limit,
  reason, team, and expiry. The work-order decision binds the immutable brief,
  append-only field amendment, fixed disposition, team, role, and shift.
- OAuth material remains in HttpOnly cookies or Node-RED credentials. Browser
  calls to the companion use `credentials: omit`.
- Canonical JSON sorts keys by UTF-8 bytes and rejects ambiguous values,
  unknown envelope fields, and non-canonical re-encoding.
- The offline artifact is `human-checkpoint-proof:v1`.
- The proof may retain claimant and credential identifiers. This is
  request-scoped key separation and exact-byte accountability, not anonymity.
- Requests expire after approximately five minutes. Changed or expired
  decisions require a fresh ceremony.
- Submitted evidence must come from real hardware; test fixtures are never
  presented as hardware proof.

## Brand Commitments

- **Name:** Human Checkpoint.
- **Voice:** operational, calm, exact, and candid. Human consequence precedes
  cryptographic detail.
- **Visual direction:** a light field-service work order. Teal moves workflow;
  restrained amber identifies hardware touch and evidence.
- **License:** `AGPL-3.0-only`.

## Evidence on Hand

MoltNet implements delegated human signing, previewSign credential lifecycle,
ARKG-P256 derivation, ESP256 verification, and the signer companion. Its
packaged real-device beta gate passed with compatible YubiKey 5.8 previewSign
hardware on 2026-07-27. This repository does not contain a captured hardware
proof until an operator completes the acceptance procedure.

No customer, deployment-scale, certification, or production-outcome claims are
available and none may be invented.

## Product Principles

1. **Human consequence first.** Explain what changes before showing the hash.
2. **Approval binds bytes.** Re-fetch and re-canonicalize authoritative state.
3. **Blocked means blocked.** No hardware-approved source check means no Exa;
   no hardware-approved work order means no release.
4. **Recovery is explicit.** Cancellation and expiry never silently bypass.
5. **Evidence travels.** Verification needs no server, companion, or hardware.

## Accessibility & Inclusion

The dashboard targets WCAG 2.2 AA: keyboard completion, visible focus,
semantic status and errors, non-color indicators, 200% zoom, narrow layouts,
and reduced-motion support.
