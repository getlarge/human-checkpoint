---
name: Human Checkpoint
description: Verified work orders with hardware-bound approval
colors:
  canvas: '#f3f6f5'
  paper: '#ffffff'
  paper-muted: '#e9efed'
  ink: '#14211f'
  ink-muted: '#536763'
  rule: '#c9d5d2'
  teal: '#087f78'
  teal-strong: '#05645f'
  amber: '#b86d08'
  amber-muted: '#fff1d6'
  success: '#277a4c'
  danger: '#b43a3a'
typography:
  headline:
    fontFamily: 'Avenir Next, Avenir, Segoe UI, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '-0.02em'
  body:
    fontFamily: 'Avenir Next, Avenir, Segoe UI, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.45
rounded:
  control: '6px'
  panel: '10px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '40px'
components:
  action-primary:
    backgroundColor: '{colors.teal}'
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '12px 18px'
  action-evidence:
    backgroundColor: '{colors.amber-muted}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '12px 18px'
  work-order:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '24px'
---

# Design System: Human Checkpoint

## Overview

**Creative North Star: “The Verified Work Order.”**

The interface feels familiar to a technician working from service records,
permit sheets, and shift handovers. It is light for workshop, van, and plant
floor use. Its signature is a clear work-order progress rail: teal shows
completed preparation; amber marks the decisions that need the technician and
YubiKey.

It refuses a generic admin dashboard, crypto-wallet theatrics, and opaque
“AI approved” badges. Every state names the actor, consequence, exact record,
and recovery action.

## Colors

Paper and cool operational neutrals own the page. Teal is only for workflow,
current navigation, and primary actions. Amber is only for YubiKey prompts,
request-scoped keys, signed evidence, and immutable checkpoints. Success and
danger always include text and symbols.

## Typography

One workhorse sans-serif family handles labels, headings, and prose. Monospace
is limited to identifiers, canonical bytes, hashes, keys, and signatures.
Human-readable summaries lead; crypto details remain available in native
`details` disclosures.

## Layout

Desktop uses a compact service header followed by full-width work-order cards:
request facts, live agent tasks, technician claim, AI brief, final approval,
and portable evidence. Below 760px cards become single-column, actions wrap,
and labelled records replace dense rows. There is no page-level horizontal
scrolling at 200% zoom.

## Elevation & Depth

Depth is structural: paper over a cool canvas, one-pixel rules, and a low
shadow under the active work record. Touch-required evidence may have an amber
inset edge. No glow, glass, floating tiles, or decorative gradients.

## Shapes

Corners are modest: 6px controls, 10px work-order panels. Status lozenges are
only for short machine states and always contain text. Custody steps stay square
and ruled like an inspection form.

## Components

- **Service header:** product, assigned request, companion state, and
  technician.
- **Request queue:** open, pending-review, and closed synthetic records.
- **Technician workspace:** assigned request, request claim, agent brief,
  work-order approval, and portable evidence in operational order. The
  read-only Node-RED flow is a separate troubleshooting link, never a numbered
  technician step.
- **MoltNet agent activity:** plain-language task purpose, durable task ID,
  attempt number, and live queued, claimed, running, or completed status.
- **Technician decision:** consequence, sources, reason, expiry, and recovery.
- **Evidence disclosure:** exact message, digest, method, request, claimant,
  credential, and derived key with announced copy actions.
- **Verification result:** aggregate and per-checkpoint status, key comparison,
  and a non-destructive tamper demonstration.

## Do's and Don'ts

### Do

- Lead with the field consequence and next action.
- Lock fields visually and programmatically after request creation.
- Pair status color with an icon or word.
- Keep evidence inspectable, selectable, and copyable.

### Don't

- Do not imply anonymous or fully unlinkable signing.
- Do not call a request approved until authoritative proof validates.
- Do not hide expiry, team, method, or request identity.
- Do not gamify touch or animate page load.
