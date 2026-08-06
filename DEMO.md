# Human Checkpoint demo — automated, captioned, 2:30 target

The recording uses browser automation, on-screen captions, and the live product
UI. No voice-over is required. The operator only performs the two physical
YubiKey touches when the signer companion pauses the run.

Never replace either ceremony with mocked evidence. It is acceptable for the
automation to wait on a captioned “Touch the YubiKey” frame until the real
ceremony completes.

## Capture sequence

### 0:00–0:18 — Assigned work

- Start on the FlowFuse service-request queue.
- Show open pump request `SR-2048`, open conveyor request `SR-2075`, and closed
  history. Let the conveyor evidence thumbnail register; if timing allows, open
  it briefly to show the three reported photos, then return to the queue.
- Open `SR-2048`.
- Caption: **An AI agent can prepare the job. The technician keeps the two
  consequential decisions.**

### 0:18–0:48 — Request claim

- Show the assignment, exact equipment lookup, allowed sites, and expiry.
- Keep **MoltNet agent activity** visible: no preparation task has started.
- Caption: **The technician sees what accepting the job will unlock. The agent
  has not reviewed history or prepared a brief.**

### 0:48–1:10 — Technician accepts the job

- Select **Claim request with YubiKey**.
- Show the local companion and pause for the first real touch.
- Caption during the pause: **Touch 1 of 2 · Claim this assigned request and
  unlock only the displayed equipment lookup.**
- Return automatically to the workspace. The request-review task starts only
  after MoltNet records the signed claim.

### 1:10–1:38 — AI technician brief

- Keep the live task ID, attempt, and status visible while the second MoltNet
  task runs after the approved-history review.
- Show the generated request summary, public guidance, site questions,
  unknowns, and source links.
- Caption: **The runtime re-fetched the approval before the lookup. The brief
  preserves unknowns instead of inventing a diagnosis.**

The conveyor photographs are technician-facing reported evidence. Do not imply
that the agent performed computer vision: their pixels never enter either
MoltNet task.

### 1:38–2:04 — Technician releases the work order

- Enter the prepared field note and select **Lock work order for approval**.
- Select **Approve work order with YubiKey** and pause for the second touch.
- Caption during the pause: **Touch 2 of 2 · Bind the immutable brief, field
  note, role, and shift to the release decision.**
- The Dashboard finalizes the release automatically after authoritative
  revalidation.

Prepared field note:

> Coupling guard removed under isolation. Alignment reading is outside the
> service limit; leave isolated pending correction and post-work vibration
> verification.

### 2:04–2:30 — Portable evidence

- Show the two request-scoped public keys and **Key separation confirmed**.
- Select **Download and verify record** and show the valid result.
- Select **Test a changed field note** and show the invalid result.
- Final caption: **The same YubiKey answered twice. Different request-scoped
  keys; exact bytes; offline tamper detection.**

## Automation boundary

The automation may navigate, click, type the prepared field note, wait for
task status, download the approval record, and run the tamper check. It must
not call hidden workflow endpoints, write directly to SQLite, complete a
MoltNet signing request, or synthesize signer output. Every application action
must travel through the visible FlowFuse Dashboard and its Node-RED wires.

The read-only Node-RED canvas is optional in the main cut. If included, show it
for at most five seconds after the queue: the three UI templates and their
durable task/approval branches are now the actual application, not a decorative
diagram.

## Capture settings

- 1440×900 or 1280×800 at 100% zoom.
- Browser notifications, password-manager overlays, and unrelated tabs off.
- Cursor visible; clicks deliberate; no artificial animation.
- Burn captions into the final MP4 so the video works muted.
- Do not show `.env.local`, generated credentials, cookies, tokens, or seeded
  passwords.

Capture fallback stills under `docs/demo-assets/`:

1. `01-request-queue.png`
2. `02-yubikey-ready.png`
3. `03-request-claim.png`
4. `04-agent-brief.png`
5. `05-work-order-approval.png`
6. `06-proof-valid.png`
7. `07-proof-tampered.png`

Run one untimed hardware rehearsal, then record at most two full takes. The
operator needs to be present only for the two touch pauses.

## Before recording

- Dashboard, agent daemon, signer companion, MoltNet, and Ory are healthy.
- The field technician is signed in and the YubiKey reports ready.
- `SR-2048` is open with no pending approval.
- `SR-2075` is open and its three reported photos render while signed in.
- Ollama Cloud and Exa credentials are available but not visible.
- `pnpm run rehearse:before-touch` passes its non-mutating service and flow
  preflight.
- The public repository permalink and submission form are ready.
