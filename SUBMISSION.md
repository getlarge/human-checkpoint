# Submission

Submission form:
<https://docs.google.com/forms/d/e/1FAIpQLSfaczYBBIYY9p3nJDQCmFmpZ0s8cHuhCbV8QP8I-mw5aOYI6A/viewform>

Organizer deadline shown in the form: **August 6 at 9:00 am PT**.

## Form page 1 — code submission

- First and last name: `Edouard Maleix`
- Email address: `ed@getlarge.eu`
- Project name: `Human Checkpoint`
- Source code: <https://github.com/getlarge/human-checkpoint/tree/v0.1.0>
- Documentation:
  <https://github.com/getlarge/human-checkpoint/blob/v0.1.0/README.md> and
  `TODO: public demo video`
- What did you learn from your project?: use the paste-ready answer below.

The `v0.1.0` links above resolve only once the tag exists. Tag after the last
commit lands, then confirm both URLs while signed out:

```bash
git tag -a v0.1.0 -m 'Human Checkpoint hackathon submission' && git push origin v0.1.0
```

## Title

Human Checkpoint — Hardware-bound approvals for AI agents

## Description

Human Checkpoint lets an AI agent prepare and coordinate field work while
reserving consequential decisions for a real technician. A single enrolled
YubiKey 5.8 uses ARKG to produce distinct request-scoped signing keys when the
technician claims the assigned request and later releases the work order.
Only after that signed claim does Node-RED start real MoltNet tasks to review
approved history and prepare the brief. Every technician decision binds exact
canonical bytes, and the completed work order exports an offline-verifiable
evidence bundle. Two realistic open requests—including a conveyor case with
technician-facing reported photos—make the workflow concrete; the agent does
not analyze image pixels.

## Links

- Repository permalink:
  <https://github.com/getlarge/human-checkpoint/tree/v0.1.0>
- Demo video: `TODO: final public URL`
- Tagged source archive:
  <https://github.com/getlarge/human-checkpoint/archive/refs/tags/v0.1.0.zip>
- Offline evidence bundle (needs no hardware to check):
  <https://github.com/getlarge/human-checkpoint/tree/v0.1.0/docs/evidence>

Judges cannot realistically run the full demo — it needs Docker with AMD64
emulation, Ollama and Exa keys, and a YubiKey 5.8 carrying previewSign. A real
proof record from the recorded ceremony is committed so the central claim can
be checked with Node alone:

```bash
pnpm install --frozen-lockfile && node scripts/verify-evidence.mjs
```

That verifies both signatures, confirms the two request-scoped ARKG keys
differ, and shows a one-character field-note change being rejected.

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

Getting to previewSign from Node.js at all meant filling an ecosystem gap.
Yubico's `build-with-us` quickstarts cover iOS/macOS, Android, .NET and Python
but not JavaScript, and the WebAuthn `sign` extension that would expose this to
browsers (w3c/webauthn#2078) has been a draft since September 2024, so no
browser ships it. We published the missing layer under MIT —
`@themoltnet/ctap` for CTAP2/HID and `@themoltnet/yubikey-preview-sign` for
enrollment, ARKG derivation, signing, offline verification and conformance test
vectors — plus a loopback companion that lets a normal web app reach a key the
web platform cannot yet address. Keeping the verification path free of any HID
or CTAP import turned out to matter most: it lets the evidence be checked in
CI, in a browser, or on a laptop that has never seen a YubiKey.

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
- [ ] Tag `v0.1.0` after the final commit; both links work while signed out.
- [ ] Public video is under three minutes and works while signed out.
- [x] One physical YubiKey records the request claim and work-order approval.
- [x] Different derived public keys are visible.
- [x] Offline proof succeeds; one-character field-note tamper fails.
- [x] Evidence committed so the claim is checkable without any hardware.
- [ ] Clean-checkout README rehearsal succeeds.
- [ ] Fallback screenshots are captured.
- [ ] This is the newest and final submission entry.

The project site under `docs/` is a bonus, not a submission requirement.
GitHub Pages is currently wedged on this repository — builds stall and
deployments are cancelled server-side on every configuration tried, while
GitHub reports Pages operational (see community discussion 49948). The
`gh-pages` branch is pushed and Pages points at it, so the site publishes
itself at <https://getlarge.github.io/human-checkpoint/> once the fault
clears. Do not block the submission on it.
