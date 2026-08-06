# previewSign from Node.js

## The gap we hit

YubiKey 5.8 ships `previewSign`, which signs arbitrary bytes with a key derived
from — but distinct from — a WebAuthn credential. It is the primitive this whole
project depends on. Getting at it from Node.js turned out to be the hard part.

**Yubico's own examples do not cover it.**
[`YubicoLabs/build-with-us`](https://github.com/YubicoLabs/build-with-us) has
quickstarts for iOS/macOS, Android, .NET/desktop, and Python. There is no
JavaScript, Node.js, or TypeScript path.

**The browser cannot do it yet either.** The WebAuthn extension that would expose
this to web pages is [w3c/webauthn#2078, "Add 'sign' extension"](https://github.com/w3c/webauthn/pull/2078)
— opened September 2024 and **still a draft**, last synced to draft version 3 in
May 2025. Its own summary is explicit that keys "remain isolated within
authenticators, never exposed to JavaScript", which is exactly the property we
want; it is simply not shippable yet. No browser exposes it.

So for a Node.js team there was no route to the feature at all: not a native SDK,
not a browser API. We wrote one.

## What we published

Three packages, all on npm, from
[getlarge/themoltnet](https://github.com/getlarge/themoltnet):

| Package                                                                                              | License       | Role                                                              | Source                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`@themoltnet/ctap`](https://www.npmjs.com/package/@themoltnet/ctap)                                 | MIT           | Minimal CTAP2/HID transport for Node.js                           | [libs/ctap](https://github.com/getlarge/themoltnet/tree/main/libs/ctap)                                 |
| [`@themoltnet/yubikey-preview-sign`](https://www.npmjs.com/package/@themoltnet/yubikey-preview-sign) | MIT           | Enrollment, ARKG derivation, signing, and offline verification    | [libs/yubikey-preview-sign](https://github.com/getlarge/themoltnet/tree/main/libs/yubikey-preview-sign) |
| [`@themoltnet/signer`](https://www.npmjs.com/package/@themoltnet/signer)                             | AGPL-3.0-only | Loopback companion so a browser can reach the key it cannot touch | [apps/moltnet-signer](https://github.com/getlarge/themoltnet/tree/main/apps/moltnet-signer)             |

The two libraries are MIT precisely so anyone hitting this gap can use them
without adopting our licence. Human Checkpoint depends on
`@themoltnet/yubikey-preview-sign` for every signature it verifies.

```bash
npm install @themoltnet/yubikey-preview-sign
```

Requires Node `^22 || >=24` and a YubiKey 5.8 advertising the `previewSign`
extension. `@themoltnet/ctap` comes along as a dependency; the signer companion
is a separate install and is only needed for browser flows:

```bash
npx @themoltnet/signer
```

Signer documentation:
<https://docs.themolt.net/understand/signing#previewsign-beta-operation>.

## Talking to the key

`PreviewSignClient` is the high-level entry point. It owns device discovery,
capability detection, enrollment, and signing.

```js
import { PreviewSignClient } from '@themoltnet/yubikey-preview-sign';

const client = new PreviewSignClient();

const devices = await client.listDevices();
const capabilities = await client.getCapabilities(devices[0]?.id);

if (!capabilities.supportsPreviewSign) {
  throw new Error('This key does not advertise the previewSign extension.');
}
```

**Detect the capability, never the firmware string.** `getCapabilities()`
returns `versions`, `extensions`, `options`, `aaguid`, `supportsPreviewSign`,
and `supportsCtap23`. A key reporting firmware 5.8 does not necessarily carry
the preview extension — this was the single most common failure we hit, and the
reason the check above is not optional.

## Enrolling

```js
const enrollment = await client.enroll({
  deviceId: devices[0].id,
  label: 'Field technician YubiKey',
});
```

`enroll()` returns an `EnrollmentRecordV1` — a serialisable record holding the
outer credential ID and public key, the preview key handle, the ARKG seed public
key, and the attestation object. Persist it; every later signature and
verification needs it.

## Signing

```js
import { createPreviewSignPrehash } from '@themoltnet/yubikey-preview-sign';

const digest = createPreviewSignPrehash(new TextEncoder().encode(payload));

const { signature, verificationKey } = await client.signDigest({
  enrollment,
  digest,
  context: new TextEncoder().encode('my-app:some-purpose'),
});
```

`signDigest()` derives a fresh ARKG key, asks the authenticator to sign, and
returns both the signature and a `VerificationKeyRecordV1`. That record carries
the derived public key plus the `ikm`, `context`, and `additionalArguments`
needed to reproduce the derivation later.

**This is where the per-decision key separation comes from.** Sign twice with
different `context` values and you get two different derived public keys from one
physical key — the property Human Checkpoint's two checkpoints rely on.

`createPreviewSignPrehash` is deliberately plain: SHA-256 of the bytes you hand
it, with no envelope and no domain prefix. Protocol framing is the caller's job,
which is why this project wraps it in its own canonical envelope before hashing.

If you already own the derivation, `signPreparedDigest()` takes a 32-byte digest
and ARKG additional arguments and passes both to the authenticator unchanged.

## Verifying — including where the key is absent

```js
import { verifyP256PrehashedSignature } from '@themoltnet/yubikey-preview-sign/verify';

const ok = verifyP256PrehashedSignature(digest, signature, publicKey);
```

The `/verify` subpath is the part worth stealing. It exports only
`createPreviewSignPrehash` and `verifyP256PrehashedSignature`, and it pulls in no
HID transport and no CTAP code. The package enforces that separation with its
own `check:verify-isolation` script.

That matters because verification should run where the hardware never goes: a CI
job, an auditor's laptop, a server that never sees a YubiKey. Human Checkpoint
uses it twice: `scripts/verify-evidence.mjs` checks the committed record from
Node, and the project site in [`docs/`](./) does the same work in a browser over
a build of that verification path — no server, no companion, and no key.

Run either locally:

```bash
node scripts/verify-evidence.mjs   # Node
pnpm run site:serve                # then open the "Verify" section
```

`client.verifyDigest({ enrollment, verificationKey, digest, signature })` is the
convenience form when you still hold the full records.

## Test vectors

The package ships a conformance vector:

```js
import vector from '@themoltnet/yubikey-preview-sign/vectors/preview-sign-v1.json' with { type: 'json' };
```

It pins the derivation inputs, additional arguments, and expected outputs, so an
independent implementation can check itself against ours without owning a key.

## The browser problem, and the companion

Because #2078 is still a draft, a web page cannot reach `previewSign` at all.
`@themoltnet/signer` is our answer: a small loopback HTTP companion that holds
the HID connection and exposes a ceremony API on `127.0.0.1`.

```bash
npx moltnet-signer
```

The browser calls it with `credentials: 'omit'`, so application cookies and
bearer tokens never reach the companion, and the companion never receives
application session state. It is the seam that lets a normal web app use a
feature the web platform does not yet expose.

## Honest limitations

- `previewSign` is a Yubico **firmware-preview** extension. It is not generic
  WebAuthn or PIV signing, and it may change before any final specification.
- These libraries are experimental and version `0.x`. Treat the wire formats as
  unstable.
- `@themoltnet/ctap` is a _minimal_ CTAP2/HID transport built for this use case.
  It is not a general-purpose FIDO stack and does not aim to replace one.
- Nothing here implements WebAuthn. When #2078 lands and browsers ship it, the
  companion becomes unnecessary for browser flows — which would be a good
  outcome.
