# Lifecycle kernel — decisions & lock register

**Status:** L0–L6 tip-synced; Spec Subscribable helpers (`stateRef` / `eventStream` / `asState`) + wire-ready `impl` on tip after this sync.  
**Owner:** Agent 5.  
**Full Eng plan (SSOT for architecture / slices / acceptance):** [`docs/plans/lifecycle-kernel.md`](../plans/lifecycle-kernel.md).  
**Guide:** [`docs/guides/lifecycle.md`](../guides/lifecycle.md).  
**Standards:** [`docs/standards/`](../standards/) — especially hyperlink-services, types-and-naming, effect-style, modules-and-boundaries, no-backward-compat, working-agreement (approve-before-lock).

This file is the **lock register**. Do not batch-lock. Present → go → mark Locked. Eng detail lives in the plan.

---

## 0. Mission (one line)

One **Lifecycle** handle (compose FiberHandle/Latch) plus **Participating** duals is the SSOT for
HyperService runtime lifecycle — badge + commands — that any HyperService adopts the same way,
and that generic tools consume without kind switches (`Lifecycle.start(jobs)` / `start(Tag)`).

---

## 1. Substrate already Eng’d (do not re-litigate) — Locked

| # | Lock | Notes |
|---|------|--------|
| S1 | Own module `hyperlink-ts/Lifecycle` | Flat Effect-true namespace; heavy bits → `internal/lifecycle*` if needed |
| S2 | PascalCase **Role** / **State** strings | `"State"` / `"Start"` / `"Pause"` / `"Resume"` / `"Stop"`; `"Idle"` / `"Running"` / `"Paused"` / `"Draining"` / `"Off"` |
| S3 | Spec Role stamps | `.pipe(Lifecycle.asState)` / `asStart` / …; Spec helpers `stateRef` / `eventStream`; duals `Lifecycle.pause(lc)` |
| S4 | `Lifecycle.State` Schema | Wire success of Role `"State"` field |
| S5 | No kind helpers in Lifecycle | No `fromWorkPool` / `fromDaemon` |
| S6 | `Lifecycle` handle + Participating duals | `make` / `start(lc\|jobs\|Tag)` — no projected Service bag / `*From` |
| S7 | `Hyperlink.deferStart` | Layer pipe (Policy-shaped, HyperService layers only); not Tag; not Policy |
| S8 | Daemon uses `make` | Restartable `restartable: true` → Idle |
| S9 | WorkPool on `make` | Badge SSOT `lifecycle`; no `status.phase`; control verb `stop` |

---

## 2. Proposed locks (owner approve item-by-item before Eng)

Status column: `Proposed` → `Locked` / `Amended` / `Rejected`.

### P1 — WorkPool engine SSOT on Effect-shaped `Lifecycle.make` — Locked (Eng’d)

- **Choose:** Retire dual `phase` + projected badge. Engine uses `Lifecycle.make({ run, latch, release, fiber })`; `shutdownMode` lives in `release`.
- **Retire:** `status.phase` entirely; `autoStart` → only `DeferStart` + deferred `run`.
- **Reject:** Keeping `phase` forever alongside `Lifecycle.State`.
- **Blocks:** L1.

### P2 — Structural capability typing — Locked (Eng’d; B amended)

- **Choose:** Caps from structure — Latch present ⇒ `LifecyclePausable` (pause/resume on the type); no Latch ⇒ `LifecycleCore` (absent members). Tools use Participating duals (`start(jobs)` / `start(Tag)`); no projected `Service` / `of` / `from`. `afterStop` ⇒ Idle vs Off after stop.
- **Keep:** `Unsupported` when Participating members absent (e.g. pause on non-pausable).
- **Reject:** Primary API as stringly `caps: ["Start","Stop"]` bag (sugar OK if derived from structure); projected Service bag.
- **Blocks:** L3.

### P3 — Spec / impl sugar — Locked (Eng’d)

- **Choose:** `Lifecycle.spec(caps?)` + `Lifecycle.impl(service)`.
- **Choose:** WorkPool control verb `shutdown` → `stop` (Role `"Stop"`).
- **Reject:** Forever mapping `shutdown`↔`stop` in `of()`.
- **Blocks:** L2.

### P4 — Lifecycle events — Locked (Eng’d)

- **Choose:** `Lifecycle.Event` union — `Started` / `Paused` / `Resumed` / `StopRequested` / `Stopped`. Fan-out `Stream` on `Service.events`.
- **Choose:** Participating / Spec field `lifecycleEvents` (distinct from domain `events` on WorkPool / Daemon).
- **Align:** WorkPool queue `events` stay item/queue domain; do not merge.
- **Reject:** Reusing WorkPool `Start` / `ShutdownComplete` as the Lifecycle protocol.
- **Blocks:** L4.

### P5 — Observe pack + generic widgets — Locked (Eng’d pack; chrome → Agent G)

- **Choose:** Pack under `ui/LifecycleView` (`pack` = badge+start/stop; `pausable` adds pause/resume). **Lifecycle must not import Observe**.
- **Choose:** All UI / web / TUI chrome adoption of the pack is **Agent G** — Agent 5 does not wire dashboard widgets.
- **Retire:** Kind-hardcoded pause/start buttons as the only path (G incremental).
- **Blocks:** L5.

### P6 — Readiness integration — Locked (Eng’d)

- **Choose:** Ready when State ∈ {`Running`, `Paused`, `Idle`}; not ready for `Draining` / `Off`.
- **Reject:** Idle ⇒ not ready (breaks A→B pending queues).
- **Blocks:** L1.

### P7 — Handoff / drain — Locked (orthogonal to Lifecycle)

- **Choose:** **Handoff and Lifecycle are unrelated planes.** Handoff is only two identical handles (`from` / `to`) plus a serve-site `HandoffFn` (`ctx.done` / `retry` / `defer`). That Effect may *read* Lifecycle State if the author wants — Lifecycle never gates or owns handoff.
- **Choose:** **No handoff fn ⇒ no migrate.** Shutdown path should only **stop** the HyperService so Scope `addFinalizer` (Lifecycle `stop`) runs. Node `phase: "draining"` stays the node plane.
- **Reject:** Lifecycle State as a precondition for handoff; conflating Node drain with HyperService Lifecycle; inventing a Lifecycle↔handoff bridge API.
- **Blocks:** L6 (docs clarity; no Lifecycle gate Eng).

### P8 — Remote parity — Locked (Eng’d)

- **Choose:** `Lifecycle.start(clientTag)` / Participating duals identical when Tag is `Hyperlink.client` (Tag overload on `start` / `pause` / `resume` / `stop` — no `*From`).
- **Reject:** Separate “lifecycle client” API; resurrecting projected `from`.
- **Proof:** `test/lifecycle-remote-http.test.ts` — WorkPool + Daemon over http; duals + Illegal from Off.
- **Blocks:** L6.

### P9 — `deferStart` composition — Locked (Eng’d)

- **Choose:** Keep Layer pipe. `DeferStart` ⇒ `make` does not `FiberHandle.run` until `start()` (State `Idle`).
- **Retire:** WorkPool `autoStart?: boolean`.
- **Blocks:** L1.

### P10 — Opt-in participation (+ Gate) — Locked (Eng’d)

- **Choose:** Lifecycle is **opt-in per HyperService** — not every Tag must participate. Toolkit kinds we ship (**WorkPool, Daemon, Gate**) **do** participate. Apps spread `Lifecycle.stateRef` / `eventStream` / verbs (or `Lifecycle.spec`) when they want tools/UI.
- **Choose (Gate):**
  - Pause: admit new calls but latch-block; **hold waiting too** (no `newOnly` knob in v1).
  - Stop: new calls error (`GateStopped`). Waiting policy **`stopMode: "failWaiting" | "finishWaiting"`**, default **`"failWaiting"`**.
  - In-flight always finishes. Live `concurrency` / `rateLimit` reconfig in the same slice.
- **Reject:** Implicit Lifecycle on every bare Rpc; Gate forever non-Participating.
- **Eng’d:** Gate participates via `Lifecycle.make({ run: Effect.never, latch, release, awaitBeforeTerminal, afterStop: Lifecycle.off })`. Wire `run` always carries engine errors **`GateStopped`** + Effect **`RateLimiterError`** (no erase) + `stopMode` (default `failWaiting`); live `setConcurrency` / `setRateLimit` wire verbs (bump `configVersion`); readiness from the Lifecycle badge. Tests: `test/gate-lifecycle.test.ts` + `test/gate-handle.test-d.ts`.
- **Blocks:** — (L7 docs shipped; Gate Eng’d).

### P11 — Module layout — Locked (Eng’d)

- **Choose:** `src/Lifecycle.ts` shell; model → `internal/lifecycleModel.ts`; engine → `internal/lifecycle.ts`.
- **Reject:** Lifecycle as its own served HyperService Tag kind; naming it `Resource`.
- **Blocks:** all slices (layout invariant).

### P12 — `@locked` on Lifecycle — Rejected

- **Reject:** Applying `@locked` to Lifecycle (or any) symbols now. Whole surface stays fluid per [Breaking Changes & Stability](../standards/no-backward-compat.md) — `@locked` only by explicit owner decision; owner ruled **nothing is `@locked` anywhere** until they say otherwise (typically 1.0 sweep).
- **Blocks:** — (L7 docs polish only; no lock annotations).

### P13 — Effect-shaped `make` (run + Latch + release) — Locked (Eng’d; A/C amended)

- **Choose:** Public `make` composes real `fibers` (FiberHandle \| FiberSet) + optional `latch` + `release` + `afterStop: Idle|Off`. Dual ops: `Lifecycle.start(lc)` / `pause` / `resume` / `stop`. Scope finalizer = `stop`.
- **Choose (C):** `Lifecycle.events(lc)` derived from `SubscriptionRef.changes` — no parallel Event PubSub.
- **Errors:** `LifecycleUnsupported` / `LifecycleIllegal` — `Effect.catchTag` / `_tag`.
- **Retire:** hook-centric `onStart`…; `fiber: "handle"|"set"` string mode; `restartable: boolean` (→ `afterStop`); Event PubSub SSOT.
- **Reject:** Custom FiberStatus; pause-via-interrupt; `forkDetach` for layer-owned services; Layer rebuild as start/stop.

---

## 3. Open questions (need owner before locking)

1. **Versioned schema** — orthogonal; keep on its own decisions doc / owner go.

---

## 4. Eng slices (pointer)

Full table + acceptance criteria: [plan §8](../plans/lifecycle-kernel.md#8-eng-slices).

| Slice | Depends | One-liner |
|-------|---------|-----------|
| **L0** | — | Land substrate on `integration` |
| **L1** | P1, P9, P6 | WorkPool engine on `make` — Eng’d |
| **L2** | P3 | `spec` / `impl`; `shutdown`→`stop` — Eng’d |
| **L3** | P2 | Capability-typed `LifecycleCore` / `LifecyclePausable` — Eng’d (A) |
| **L4** | P4 | `Event` + `lifecycleEvents` — Eng’d |
| **L5** | P5 | `ui/LifecycleView` pack — Eng’d (chrome follow-up) |
| **L6** | P7, P8 | Handoff docs + remote Participating duals — **Eng’d** |
| **L7** | P10 | Docs polish (no `@locked`) + Gate Lifecycle — **Eng’d** |

---

## 5. Immediate next step

1. P10 Eng’d — Gate Lifecycle shipped (`stopMode` default `failWaiting`; pause hold-all; live `setConcurrency` / `setRateLimit`). Tests: `test/gate-lifecycle.test.ts`.  
2. P12 Rejected — zero `@locked` annotations.  
3. P5 chrome → Agent G. Open questions: §3.

---

## 6. Rejected (already)

| Rejected | Why |
|----------|-----|
| `Policy.autoStart` | Wrong grain |
| Tag-piped `deferStart` / `Lifecycle.deferred` | Runtime mode is Layer |
| `fromWorkPool` / `fromDaemon` | Kind privilege |
| Lifecycle as served HyperService Tag | Protocol, not sibling resource |
| Conflating Node `phase` with HyperService State | Two planes |
| Annotation-only without Participating duals | Tools need typed start/stop on the handle |
| Projected `Lifecycle.Service` / `of` / `from` / `*From` | Lean duals: `start(lc\|jobs\|Tag)` overloads |
| P12 — `@locked` on Lifecycle now | Surface stays fluid; owner: nothing `@locked` anywhere until they say |
