# Submission

Submission form:
<https://docs.google.com/forms/d/e/1FAIpQLSfaczYBBIYY9p3nJDQCmFmpZ0s8cHuhCbV8QP8I-mw5aOYI6A/viewform>

Organizer deadline shown in the form: **August 6 at 9:00 am PT**.

## Form page 1 — code submission

- First and last name: `TODO`
- Email address: `TODO`
- Project name: `Human Checkpoint`
- Source code: <https://github.com/getlarge/human-checkpoint/tree/v0.1.0>
- Documentation:
  <https://github.com/getlarge/human-checkpoint/blob/v0.1.0/README.md> and
  `TODO: public demo video`
- What did you learn from your project?: use the paste-ready answer below.

## Title

Human Checkpoint — Hardware-bound approvals for AI agents

## Description

Human Checkpoint lets an AI agent prepare and coordinate field work while
reserving consequential decisions for a real technician. A single enrolled
YubiKey 5.8 uses ARKG to produce distinct request-scoped signing keys for a
public-source check and final work-order release. Node-RED durably orchestrates
real MoltNet agent tasks, every technician decision binds exact canonical
bytes, and the completed work order exports an offline-verifiable evidence
bundle.

## Links

- Repository permalink:
  <https://github.com/getlarge/human-checkpoint/tree/v0.1.0>
- Demo video: `TODO`
- Tagged source archive:
  <https://github.com/getlarge/human-checkpoint/archive/refs/tags/v0.1.0.zip>

## Learnings

YubiKey 5.8 previewSign made the human decision meaningful before the touch:
MoltNet could fix the exact action, derive request-scoped verification
material, and wait while the private operation remained on the technician's
key. One enrolled YubiKey could approve two different service decisions without
reusing the same action key.

The hardest part was preserving boundaries across the whole AI workflow:
canonical bytes, request state, method identity, prehash semantics, Node-RED
restart recovery, browser OIDC, a loopback HID companion, and an agent tool that
can accept an approval ID but cannot choose its own search scope. Short-lived
requests also made recovery part of security: changed or expired decisions
require a new ceremony, never a refreshed approval.

## Form page 2 — meta section

Complete these after the rated submission fields:

- Availability for the public webinar on **August 13 at 8:00 am PT**: `TODO`
- Preferred shirt size: `TODO`
- Overall event rating: `TODO`
- Interaction with the Yubico team rating: `TODO`
- What would improve that rating?: `TODO`
- Would you recommend Yubico products to company stakeholders?: `TODO`
- Perception before the event and how building changed it: `TODO`
- Explain the YubiKey and its value to a peer: `TODO`
- Other feedback: `TODO`

## Final checklist

- [ ] Use the canonical Google Form linked above.
- [ ] Submit before August 6 at 9:00 am PT.
- [ ] Immutable repository and tagged archive links work while signed out.
- [ ] Public video is under three minutes and works while signed out.
- [x] One physical YubiKey approves the public-source check and work order.
- [x] Different derived public keys are visible.
- [x] Offline proof succeeds; one-character field-note tamper fails.
- [ ] Clean-checkout README rehearsal succeeds.
- [ ] Fallback screenshots are captured.
- [ ] This is the newest and final submission entry.
