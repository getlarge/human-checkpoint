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

## Adding the demo video

Drop `walkthrough.mp4` (or `.webm`) into `demo-assets/`, or set `VIDEO_URL` at
the top of the page script to a YouTube, Vimeo, or direct-file URL. Until then
the player hides itself and shows a placeholder. Fallback stills belong in
`demo-assets/` using the names listed in `../DEMO.md`.
