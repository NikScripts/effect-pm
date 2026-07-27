# Brief — Launcher + node handoff (new agent)

**Status:** Track A Eng'd — `hyperlink-ts/Launcher` + `Node.assume` on tip; Tracks B/C/D still bake.  
**Opened:** 2026-07-25 (owner via Agent G).  
**Audience:** next agent picking up launcher + handoff / migration discussion.

---

## Locked (2026-07-27, owner)

1. **Spine α — dumb spawn-and-exit launcher.** Bring-up only; exits when the spawn job is done. Not a long-lived fleet supervisor. Nodes own processes after start; Lookup is the control brain. (Rejects spine β: launcher-as-`Layer.launch(Fleet…)` lifecycle owner.)
2. **No Eng until API is locked with the owner.** Design → owner go on concrete API surface → then build. No APIs from `launcher-decisions.md` memory.
3. **Bake order:** Track **A** (spawn+exit launcher API) first; then B (Lookup-directed startup), C (handoff), D (clients). Do not tangle tracks.
4. **Track A exit gate = Ready** (not merely spawned, not Lookup-registered). Launcher waits until the child is ready, then exits. Registration / Lookup remains the child’s (node’s) job after that.
5. **Launcher → node ownership transfer is explicit** — not only “process is up, launcher walks away.”
6. **Track A handoff shape = both (parent steps + child ack):**
   - **Parent API** exposes composeable phases (not a buried `launch`): roughly `spawn → awaitReady → handoff → exit`.
   - **Child** must **ack** ownership (“I am ready; I own myself”) so the transfer is a real handshake on the wire, not an assumption from readiness alone.
   - Prefer reusing existing node / verify substrate for the ack; **no new control plane**. Verb locked in #11 (`Node.assume`).
7. **Ready is first-class and high-bar** (owner: “first class and top notch”) — not “port open / process alive.”
   - **Child** declares readiness through the existing **`withReadiness` / `Readiness` / node status** surface (served Hyperlinks participate; defaults ready when unset).
   - **Launcher `awaitReady`** is a **named phase** that waits until that readiness is true **and** proven cross-process (reuse `verifyConnection` / deep classify — loud failures, typed errors). No ad-hoc health hacks.
   - **Ready ≠ ownership.** Ready means “fit to serve”; **handoff ack** (locked #6) is the separate “I own myself; launcher may exit” step.
   - Quality bar: Effect-shaped API, Schema/tagged errors, no silent timeouts-as-success; composeable with Track A phases.
8. **`awaitReady` aggregation = allReady by default, configurable escape hatch.**
   - **Default:** every served Hyperlink on the node must be ready (`allReady`-shaped).
   - **Escape hatch:** caller may narrow (critical subset / Lookup-first / staged bring-up) without a second readiness system — same `withReadiness` substrate, scoped set.
9. **Ownership ack = first-class node RPC verb** (not a status-poll side effect, not a bring-up-only side channel).
   - Launcher calls it **after** Ready; child acks “I own myself; launcher may exit.”
   - Effect/Schema, loud typed failures.
   - Node status may **mirror** ownership for dashboards; the handshake is the verb.
   - Verb: **`Node.assume`** (see #11).
10. **Module split (parent vs node):**
    - **`hyperlink-ts/Launcher`** — short-lived bring-up toolkit: `spawn` / `awaitReady` / `handoff` (+ convenience `up`).
    - **`Node`** — owns readiness surface + ownership **ack RPC** (steady-state control plane after launcher exits).
    - **CLI** (`hl` / `hyperlink` later) — thin over Launcher; not a second control plane.
    - Do **not** put OS spawn into `Node` (already transport/catalog-heavy).
11. **API names (locked):**
    - Parent: `Launcher.spawn` → `Launcher.awaitReady` → `Launcher.handoff`; convenience `Launcher.up` = compose of those then exit.
    - Node ownership RPC: **`Node.assume`** (child assumes ownership; launcher may exit).
    - Rejected names: `launch` (reads as long-lived / spine β), `release` (collides with WorkPool.release), `fork` (OS/Effect ambiguity).
12. **`Group` is not a process / launch cohort.**
    - Group = **hierarchy of handles** for organization in general (same handle may appear in **many** groups).
    - You *can* group layers via Group, but that is not exclusive or load-bearing for launch.
    - Launcher must **not** treat `Group` as “the set of OS processes to spawn” or as SSOT for placement/process topology (Lookup/Node remain that).
    - CLI path sugar from group paths (if any) is addressing ergonomics only — not ownership of lifecycle.
13. **Product = library launcher (spine α), not blank-worker/Lookup-day-one, not “no launcher package.”**
    - Ship `hyperlink-ts/Launcher` + `Node.assume` / Ready handshake; optional thin `hl up` later.
    - **v1 grain:** 1 node ↔ 1 OS process; parent **probes** Ready (`verifyConnection` / status); child is an **autonomous entry** (app owns serve/listen in its `main`).
    - Track **B** (Lookup-directed / blank worker) later — keep assume/ready on Node so it can plug in.
    - Rejected for Track A: host-only bring-up with Hyperlink as handshake docs alone; collapsed process|fiber (`hl dev`) deferred.
14. **Spawn input (unit) locked:**
    ```ts
    {
      node: AnyNode  // dial / verify / handoff target
      process: ChildProcess  // Effect ChildProcess.make(…)
      // optional sugar: entry (+ cwd/env/exec) that builds ChildProcess
      ready?: {
        resources?: ReadonlyArray<string>  // tag keys; omit ⇒ allReady-shaped
        timeout?: Duration.Input
      }
    }
    ```
    - Multi-node: `ReadonlyArray` of that unit (thin alias OK later). **Not** `Group`.
    - Grounded in nameless-listen demo + `verifyConnection` / `Node.status` keys.
15. **Parent API = custody handle + `Launcher.up`.**
    - `Launcher.spawn(spec)` → **`Launcher.Handle`** (custody; launcher still holds the child) with `.awaitReady()` / `.handoff()`.
    - `.handoff()` performs `Node.assume` on the wire; custody ends; do not use the handle for control afterward; launcher may exit.
    - `Launcher.up(spec | ReadonlyArray<spec>)` = spawn → awaitReady → handoff (per unit) then exit — one-shot (`Handle` only internal to `up`).
    - **Only** `spawn` / `up` construct a `Handle` — no public constructors.
    - Primary surface is the handle, not flat `Launcher.awaitReady(child)` free functions.
16. **Custody type name = `Launcher.Handle`** (docs may say “custody”; reject `Custody` / `Child` as the type name).
17. **Effect for everything (hard — owner).** Launcher / assume / Ready path follows package Effect platform policy end-to-end:
    - **Process:** Effect `ChildProcess` / `ChildProcessSpawner` (+ `@effect/platform-node` layers) — **no** raw `node:child_process` / `spawn`.
    - **Time / wait:** Effect `Schedule` / `Duration` / `TestClock` in tests — **no** ad-hoc `sleep` as the Ready gate (demos may; library must poll with Effect).
    - **Config / token inject sugar:** Effect `Config` (or typed spawn options), **not** bare `process.env` as API or protocol.
    - **Errors:** `Data.TaggedError` / `Schema.TaggedError` — **never** extend native `Error`; no message-string matching.
    - **Wire:** Schema-first RPC for `Node.assume`; verify/Ready reuse existing Effect `verifyConnection` / status.
    - **Composition:** `Effect` / `Layer` / `Scope` — no Promise/`async` in Launcher internals.
    - Browser doesn’t OS-spawn; `Launcher` is a Node-platform module. **`Node.assume` / Ready stay wire-portable** (http/ws/ipc).
18. **`Node.assume` wire = token payload (open injection).**
    - RPC: `assume({ token: string })` — Schema’d; loud tagged failures (`AssumeTokenMismatch` / reuse / not-ready).
    - Launcher **mints** token at `spawn`, holds on `Launcher.Handle`; `.handoff()` calls `assume({ token })`.
    - **Injection is not the protocol** — app chooses how the child learns the token (`ChildProcess` env/argv/etc. via Effect process options, or later bootstrap). Optional **Effect `Config`** helper for local Node; not required.
    - Child **rejects** `assume` until Ready. Status may mirror `ownership: "launcher" | "self"`.
    - Rejected as default: nullary `assume()`; env-as-wire-contract; bidirectional launcher server for v1.
19. **Ready / handoff failure channels (tagged only).**
    - Reuse verify stack where it fits: `NodeUnreachable` (and kin), `ServiceNotReady` as **transient** while polling.
    - **New:** `Launcher.ReadyTimedOut` `{ node, resources?, timeout }` — bound wait expired.
    - **New:** `Launcher.ChildExited` `{ node, code? }` — child dies during `awaitReady`.
    - **New (assume):** `AssumeTokenMismatch` / `AssumeTokenReused` / `AssumeNotReady` — Schema/TaggedError.
    - Poll with Effect `Schedule` + `Duration` from `ready.timeout` (default **`"30 seconds"`** unless Eng finds a better house default).
    - No native `Error`, no message-string matching; tests use `TestClock`.
20. **Assume token = opaque high-entropy string (Effect mint + Redacted).**
    - Mint with Effect `Random` (sufficient bytes → hex or base64url) — **no** raw `crypto.randomUUID` / Node crypto in app code.
    - Wire: `Schema.String` (optional brand `Launcher.Token` if it stays thin).
    - Hold and log as **`Redacted`** — never cleartext in logs.
    - Reject UUID-as-the-story if it implies non-Effect globals; brand OK as sugar over the same mint.
21. **Package export = own subpath `hyperlink-ts/Launcher`.**
    - Public module: `src/Launcher.ts` (flat Effect-true namespace) + `src/internal/launcher.ts` engine as needed.
    - Barrel / `package.json` `exports` entry for `hyperlink-ts/Launcher` — **not** nested under `Node`.
    - **Node-platform only** (mirror other OS-spawn entrypoints); `Node.assume` / Ready stay on `hyperlink-ts/Node` and remain wire-portable.
    - Eng may choose exact packaging nuance (e.g. peer `@effect/platform-node`) without reopening the subpath decision.

Historical “Locked” rows in [`launcher-decisions.md`](./launcher-decisions.md) remain **reference only** unless re-locked here.

### Track A — research note (2026-07-27): what already exists

**Build on (shipped):**
- OS child pattern: Effect `ChildProcess` / `ChildProcessSpawner` (see `examples/forms/hyperlink/node-nameless-listen-demo.ts`) — no package Launcher yet; demos `spawn` + sleep.
- Child entry: `Layer.launch(Node.unix|http|ws(…, [Hyperlink.serve…]))` forms.
- Ready substrate: `withReadiness` / `Readiness` / `allReady` / `Node.status` (`resources[].ready`) / `Hyperlink.verifyConnection` (deep + optional `resource` → `ServiceNotReady`).
- Identity/placement: `Lookup.Identity` / `Directory` / `Advice`, `Hyperlink.identity` — child’s job after Ready.
- Ops CLI: `Hyperlink.cli` + TUI — **control surface on running services**, not bring-up.
- `Group.Tag` / `members` / `isGroup` — handle hierarchy only (`src/Group.ts`).

**Gone / do not resurrect:** `ProcessManager`, `ProcessGroup`, legacy `effect-pm-group-child`, `Fleet.launch` (spine β).

**Gaps vs Track A (closed):** `hyperlink-ts/Launcher` + `Node.assume` + Ready poll + spawn→ready→assume→unref kit are on tip. Remaining product gaps are Tracks B/C/D.

### Track A — Eng'd (2026-07-27)

Shipped on tip (owner Eng go):

- `hyperlink-ts/Launcher` — `spawn` / `Handle.awaitReady` / `Handle.handoff` / `up` / `mintToken`
- `Node.assume({ token })` + `AssumeTokenMismatch` / `AssumeTokenReused` / `AssumeNotReady`
- `ListenOptions.assumeToken` / `Node.assumeTokenConfig` (`HYPERLINK_ASSUME_TOKEN`)
- Status mirror `ownership?: "launcher" | "self"` when assume is armed
- Tests: `test/node-assume.test.ts`, `test/launcher.test.ts` (+ `.test-d.ts`)

Eng defaults: 32-byte hex token; Ready poll `100 millis` with per-dial `2 seconds` bound; outer default `"30 seconds"`.

**Next bake:** Track B (Lookup-directed startup), then C (version handoff), D (clients during handoff).

---

## Owner framing (read this first)

### Launcher — expect to start over

Prior notes (`launcher-decisions.md`, Agent F bake) are **reference only**. Treat every “Locked” / “Proposed” row there as **historical opinion**, not binding. You are **just as likely to redesign from scratch**. Do not Eng launcher APIs off that doc without a fresh owner bake.

### Contract drift detection — solid (keep)

F4 / `contractHash` / default-on verify / loud-failures taxonomy **shipped** (Agent E design → Agent 3 Eng). Prefer **reuse** over reinventing. See:

- [`loud-failures-design.md`](./loud-failures-design.md)
- [`verify-connection-classification.md`](./verify-connection-classification.md)
- `Hyperlink.contractHash`, `ContractMismatch`, `NodeStatus.resources[].contractHash`

That stack answers: *“client and server disagree on the wire contract → fail loud.”*  
It does **not** answer cross-version state migration or zero-downtime handoff.

### Prefer existing concepts

**Do not invent new concepts unless they are really, really good.** Prefer `Group`, `Node`, Lookup (`Identity` / `Directory` / `Advice`), `Layer` / `Scope` / `Schedule`, Daemon machinery, existing serve/client surfaces. New nouns need a high bar and owner approval.

---

## Direction the owner wants explored (not locked — discuss)

### 1. Dumb launcher, then exit

- Launcher’s job is **bring-up only**: spawn process(es), then **exit when that job is done**.
- It is **relatively dumb** — not a long-lived supervisor owning the fleet forever.
- Ongoing control lives on **nodes**, especially the **Lookup node**.

### 2. Daemon ownership = the Node

- **As soon as a process starts, it is owned and controlled by the nodes.**
- All process controls (shutdown, drain, restart signals that matter, etc.) go **through the node** — not through a lingering launcher daemon.
- Launcher does not remain the control plane after spawn.

### 3. Lookup directs startup

- When a node goes through startup, the **lookup node tells it what to do** (placement / role / whether to take over, etc. — exact verbs TBD; reuse Lookup surfaces where possible).
- Launcher is not the brain after spawn; Lookup is.

### 4. Version upgrade → handoff

- If the new node is an **updated version of an existing node**, a **handoff** is triggered.
- Each service that **supports** handoff must have handoff **configured in its layers**.
- When handoff completes, the **old node shuts down** (via node control plane, not launcher).
- Mission framing (still design-only): [`node-handoff-mission.md`](./node-handoff-mission.md) — zero-downtime updates + cross-version skew as normal.

### 5. Clients during handoff — open

How **clients** handle node handoff (redirect, dual-serve, drain, retry, discovery) is a large open discussion. Capture options; do not pretend it’s solved. Drift detect (`contractHash`) is substrate, not the full client story.

---

## Reference corpus (non-binding except drift Eng)

| Doc | Use as |
|-----|--------|
| [`launcher-decisions.md`](./launcher-decisions.md) | Prior bake notes — **reference only, not locked** |
| [`node-handoff-mission.md`](./node-handoff-mission.md) | Mission boundaries + hard problems — **not a decisions bake** |
| [`loud-failures-design.md`](./loud-failures-design.md) | Drift / verify — **Eng’d, prefer keep** |
| [`verify-connection-classification.md`](./verify-connection-classification.md) | Deep verify ladder — **Eng’d** |
| [`identity-coordinator.md`](./identity-coordinator.md) + guide | Lookup / identity — shipped control loop to lean on |
| [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) | Catalog / discovery context |

---

## Suggested first moves

1. Repeat back owner framing (dumb launcher → exit; node owns process; Lookup directs; handoff on version upgrade; no new concepts without bar).
2. Inventory what Lookup already exposes that can drive “tell the new node what to do” without new control planes.
3. List handoff options for **stateless vs stateful** services and what “configured in layers” might mean — design only.
4. Separate tracks in writing: **(A) spawn+exit launcher**, **(B) Lookup-directed startup**, **(C) service handoff + old node shutdown**, **(D) client behavior during handoff**.
5. Bring open questions to owner; **no Eng** on launcher until a fresh bake says go.

---

## Out of scope for this brief

- Dashboard / `View` registry redesign (Agent G).
- Reopening named-handles / Soft storage tracks.
- Treating `launcher-decisions.md` “Locked” rows as approved for implementation.

---

## Short prompt (paste to new agent)

```
Read docs/handoffs/launcher-and-handoff-brief.md carefully.

You own launcher + node handoff design discussion. NOTHING about the launcher
is locked — launcher-decisions.md is reference only; expect to start over.
Contract drift detection (contractHash / verify / loud-failures) is solid — reuse it.

Owner intent: dumb launcher that exits when spawn job is done; as soon as a
process starts, nodes own it (all controls through the node); Lookup tells new
nodes what to do; version upgrade triggers handoff (per-service, configured in
layers; old node shuts down when done); clients-during-handoff is open.

Do not invent concepts unless they are really really good. Plan-first; no Eng
until owner bakes items. Repeat the framing back before proposing APIs.
```
