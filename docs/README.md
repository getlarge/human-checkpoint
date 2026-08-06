# Project site

`index.html` is a self-contained explainer for GitHub Pages. It carries no
framework, no build step for the markup, and no external requests.

## Publishing

Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder
`/docs`. No workflow or CI is needed.

`docs/vendor/` is generated but **must be committed**, because Pages serves the
directory as-is.

## Rebuilding the vendored code

```bash
pnpm run site:build   # compiles core, then vendors the gate into docs/vendor
pnpm run site:serve   # http://127.0.0.1:8899
```

A local server is required: the page loads ES modules and fetches the evidence
record, so `file://` will not work.

## What is real and what is narration

Two sections execute real code, and the page says so in place:

- **Run the real authorization gate** imports the compiled
  `assertApprovedCheckpoint()` from `@human-checkpoint/core` and calls it
  against the recorded approval in `evidence/`. Every verdict and reason string
  comes from the shipped function. It does not contact MoltNet and does not
  perform a ceremony — it replays a recorded approval through the genuine gate,
  with expiry evaluated as of the moment that approval completed.
- **Verify the real signatures** runs ECDSA P-256 verification with the Web
  Crypto API over the real hardware signatures: it rebuilds the signed payload
  from the canonical message and nonce, recomputes the digest, and checks each
  signature against its derived public key.

**Walk the technician's flow** is narration — a stepped diagram, not a live
system. It is labelled as such on the page, because running the real workflow
needs Docker, MoltNet, Ory, Node-RED, the agent daemon, the signer companion,
and a physical key.

Two small shims let the compiled modules load in a browser, both written by
`scripts/build-site-vendor.mjs`:

- `node-crypto-shim.js` satisfies the `createHash` import. The gate path never
  hashes, so it throws if it is ever reached.
- `buffer-shim.js` provides the `Buffer.from` / `Buffer.compare` pair used to
  sort canonical JSON keys by UTF-8 bytes. Its ordering matches Node's.

No other line of the gate is altered.

## Demo video

`demo-assets/walkthrough.mp4` is the edited 1080p walkthrough used by the site.
It begins after the one-time YubiKey enrollment, states that prerequisite on
screen, marks the off-screen field inspection before the technician's final
note, preserves both real signer ceremonies at normal speed, and accelerates
only the agent-task wait. The 105-second H.264 file is approximately 8 MB.

To replace it, write a new `walkthrough.mp4` (or `.webm`) into `demo-assets/`,
or set `VIDEO_URL` at the top of the page script to a YouTube, Vimeo, or
direct-file URL.

## Node-RED screenshots

- `screenshots/yubikey-ready.jpg` — the live setup page confirming the local
  companion, enrolled YubiKey credential, and team activation.
- `screenshots/node-red-flow-overview.jpg` — the complete durable workflow.
- `screenshots/node-red-review-and-preparation.jpg` — request review, claim,
  and agent preparation lanes.
- `screenshots/node-red-release-and-proof.jpg` — signed release and offline
  evidence lanes.
- `screenshots/node-red-flow-ui-and-nodes.jpg` — the flow beside the custom
  Human Checkpoint nodes and FlowFuse Dashboard layout.

These images are documentation artifacts from the running read-only editor,
not diagrams recreated after the fact.
