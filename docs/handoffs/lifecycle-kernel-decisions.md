# Lifecycle kernel — decisions & lock register

**Status:** plan baked — substrate Eng’d on `cursor/lifecycle-defer-start-929b`; dream not Eng’d.  
**Owner:** Agent 5.  
**Full Eng plan (SSOT for architecture / slices / acceptance):** [`docs/plans/lifecycle-kernel.md`](../plans/lifecycle-kernel.md).  
**Guide (shipped substrate):** [`docs/guides/lifecycle.md`](../guides/lifecycle.md).  
**Standards:** [`docs/standards/`](../standards/) — especially hyperlink-services, types-and-naming, effect-style, modules-and-boundaries, no-backward-compat, working-agreement (approve-before-lock).

This file is the **lock register**. Do not batch-lock. Present → go → mark Locked. Eng detail lives in the plan.

---

## 0. Mission (one line)

One **Lifecycle.Service** is the SSOT for HyperService runtime lifecycle — badge + commands — that
any HyperService adopts the same way, and that generic tools consume without kind switches.

---

## 1. Substrate already Eng’d (do not re-litigate) — Locked

| # | Lock | Notes |
|---|------|--------|
| S1 | Own module `hyperlink-ts/Lifecycle` | Flat Effect-true namespace; heavy bits → `internal/lifecycle*` if needed |
| S2 | PascalCase **Role** / **State** strings | `"State"` / `"Start"` / `"Pause"` / `"Resume"` / `"Stop"`; `"Idle"` / `"Running"` / `"Paused"` / `"Draining"` / `"Off"` |
| S3 | Spec Role stamps | `.pipe(Lifecycle.pause)` etc. — same grain as `.annotate`; preserve `Marked`/`ref` |
| S4 | `Lifecycle.State` Schema | Wire success of Role `"State"` field |
| S5 | No kind helpers in Lifecycle | No `fromWorkPool` / `fromDaemon` |
| S6 | `Lifecycle.Service` + `make` / `of` / `from` | Impl + tool ends |
| S7 | `Hyperlink.deferStart` | Layer pipe (Policy-shaped, HyperService layers only); not Tag; not Policy |
| S8 | Daemon uses `make` | Restartable `afterStop: "Idle"` |
| S9 | WorkPool **projects** today | Engine still owns `phase`/`paused`; adapter `Lifecycle.of(…)` — **temporary** until plan L1 |

---

## 2. Proposed locks (owner approve item-by-item before Eng)

Status column: `Proposed` → `Locked` / `Amended` / `Rejected`.

### P1 — WorkPool engine SSOT on `Lifecycle.make` — Proposed

- **Choose:** Retire dual `phase` + projected badge. Engine latch/pause/`shutdownMode` remain; badge transitions go through `make`.
- **Retire:** Public reliance on `status.phase` for lifecycle badge; `autoStart` config flag → only `Hyperlink.deferStart` + `make({ initial })`.
- **Reject:** Keeping `phase: "idle"|"running"|…` forever alongside `Lifecycle.State`.
- **Blocks:** L1.

### P2 — Capability typing — Proposed

- **Choose:** Type-level caps so Daemon’s `Service` has no `pause`/`resume` members; not `Effect.fail(Unsupported)` as the happy path for tools.
- **Keep:** `Unsupported` only for dynamic/partial discovery, or drop if caps always known.
- **Propose:** `Lifecycle.make({ caps: ["Start", "Stop"], … })` + `Service<R, Caps>`.
- **Reject:** Stringly optional methods with no type distinction.
- **Blocks:** L3.

### P3 — Spec / impl sugar — Proposed

- **Choose:** `Lifecycle.spec(caps?)` + `Lifecycle.impl(service)`.
- **Propose (prefer):** Rename WorkPool control verb `shutdown` → `stop` (Role `"Stop"`).
- **Reject:** Forever mapping `shutdown`↔`stop` in `of()`.
- **Blocks:** L2.

### P4 — Lifecycle events — Proposed

- **Choose:** `Lifecycle.Event` union — `Started` / `Paused` / `Resumed` / `StopRequested` / `Stopped`. Fan-out `Stream` on `Service.events`.
- **Align:** WorkPool queue `events` stay item/queue domain; do not merge.
- **Reject:** Reusing WorkPool `Start` / `ShutdownComplete` as the Lifecycle protocol.
- **Blocks:** L4.

### P5 — Observe pack + generic widgets — Proposed

- **Choose:** Pack under `ui/LifecycleView` (or Observe consumer). **Lifecycle must not import Observe**.
- **Choose:** Default dashboard/TUI control chrome via Role discovery + typed `from`.
- **Retire:** Kind-hardcoded pause/start buttons as the only path.
- **Blocks:** L5.

### P6 — Readiness integration — Proposed

- **Choose:** Ready when State ∈ {`Running`, `Paused`, `Idle`}; not ready for `Draining` / `Off`.
- **Reject:** Idle ⇒ not ready (breaks A→B pending queues).
- **Blocks:** L1.

### P7 — Handoff / drain — Proposed

- **Choose:** Node `phase: "draining"` remains **node** lifecycle; HyperService may enter `Draining` separately. Document both planes.
- **Propose:** Handoff runner may `Lifecycle.from(Tag)` and require State compatible with migrate. Exact gate TBD with Track C.
- **Blocks:** L6.

### P8 — Remote parity — Proposed

- **Choose:** `Lifecycle.from(clientTag)` identical when Tag is `Hyperlink.client`.
- **Reject:** Separate “lifecycle client” API.
- **Blocks:** L6.

### P9 — `deferStart` composition — Proposed

- **Choose:** Keep Layer pipe. `make` reads `Hyperlink.DeferStart` when `initial` omitted.
- **Retire:** WorkPool `autoStart?: boolean` after P1.
- **Blocks:** L1.

### P10 — Gate / plain Rpc — Proposed

- **Choose:** Opt-in only. Gate stays out of v1 dream Eng.
- **Reject:** Implicit Lifecycle on every HyperService.
- **Blocks:** L7 docs clarity.

### P11 — Module layout — Proposed

- **Choose:** `src/Lifecycle.ts` shell; machine / events → `src/internal/lifecycle.ts` when grown.
- **Reject:** Lifecycle as its own served HyperService Tag kind.
- **Blocks:** all slices (layout invariant).

### P12 — Lock / semver — Proposed

- **Choose:** Substrate + dream unlocked until owner `@locked` on `Lifecycle.Service` / `State` / `Role`. Pre-1.0 breaking renames are minors with changeset.
- **Blocks:** L7.

---

## 3. Open questions (need owner before locking)

1. **P1:** Drop `status.phase` entirely, or keep as deprecated mirror of State for one cycle?
2. **P3:** Rename WorkPool `shutdown`→`stop` in the same slice as spec sugar, or two steps?
3. **P2:** Caps as type param union vs separate `Service.StartStop` / `Service.Pausable` interfaces?
4. **P5:** Who owns generic chrome — Agent 5 (Lifecycle) or Agent G (TUI/dashboard)?
5. **P7:** Exact handoff × Lifecycle gate (must be Idle? may be Running? drain first?) — align with launcher brief Track C.
6. **Versioned schema** — orthogonal; keep on its own decisions doc / owner go.

---

## 4. Eng slices (pointer)

Full table + acceptance criteria: [plan §8](../plans/lifecycle-kernel.md#8-eng-slices).

| Slice | Depends | One-liner |
|-------|---------|-----------|
| **L0** | — | Land substrate on `integration` |
| **L1** | P1, P9, P6 | WorkPool engine on `make` |
| **L2** | P3 | `spec` / `impl`; `shutdown`→`stop` |
| **L3** | P2 | Capability-typed `Service` |
| **L4** | P4 | `Event` + `events` |
| **L5** | P5 | `ui/LifecycleView` pack |
| **L6** | P7, P8 | Handoff + remote `from` |
| **L7** | P10+ | Docs + `@locked` candidates |

Until P-locks land: **no dream Eng**; substrate-only fixes OK on the work branch.

---

## 5. Immediate next step

1. Owner walks **P1 → P12** (approve / amend / reject) item-by-item.  
2. Agent lands **L0** when owner says.  
3. First dream Eng = **L1** after P1/P9/P6 Locked.

---

## 6. Rejected (already)

| Rejected | Why |
|----------|-----|
| `Policy.autoStart` | Wrong grain |
| Tag-piped `deferStart` / `Lifecycle.deferred` | Runtime mode is Layer |
| `fromWorkPool` / `fromDaemon` | Kind privilege |
| Lifecycle as served HyperService Tag | Protocol, not sibling resource |
| Conflating Node `phase` with HyperService State | Two planes |
| Annotation-only without Service | Tools need a typed handle |
