# 09 — Process v2: effect-first, Layer-backed polling & schedule

## Status

**Canonical.** This document is the source of truth for the next `Process`
implementation and its integration with `ProcessGroup`, `ControlService`, and
exports. Code or other docs that disagree with **this** file are wrong until
updated.

## Relationship to older plans

- **[04 — Process types & schedule control](./04-process-types-and-control.md)**  
  Described multi-schedule keys, `ProcessControl`, and reconciler-driven
  convergence. **Process v2 does not use that reconciliation model.**  
  For **runtime shape, DX, and services**, follow **this doc (09)** only.  
  04 remains historical context unless it is rewritten to align with 09.

- **[05 — State & reconciler](./05-state-and-reconciler.md)**  
  Not the driver for Process v2 arm/disarm or polling cadence. Any future
  reconciler work is orthogonal unless explicitly merged into this plan.

## Goals

1. **`effect` is the primary surface** — `Process.make({ name, effect })` puts
   the domain work first. Nothing nests the work under polling as `tick` or
   similar.

2. **Schedule ≠ polling**  
   - **Schedule** (service): whether **polling is allowed** (armed /
     disarmed). Does *not* define “every N seconds.”  
   - **Polling** (service): while armed, **how often** (or how) the same
     **`effect`** runs — fixed spacing, accelerating curve, etc.

3. **Effect-native configuration** — **`Context.Tag` services** + **`Layer`**
   (`Layer.mergeAll`, `Layer.provideMerge`, scoped layers). Optional **inline**
   `polling` / `schedule` on `Process.make`, or **omit** and satisfy requirements
   at the group/app — **same semantics**, two ergonomics.

4. **Optional pipe** — `Process.make({ name, effect }).pipe(Process.providePolling(l), …)` equivalent to optional fields on `make`.

5. **Reuse** — `ProcessStore` for per-tick (and lifecycle where applicable),
   `ProcessGroup` fork-in-scope + start/stop, existing logging patterns where
   they still fit.

6. **Accelerating poll** — Supported as a **preset** (e.g. `Polling.accelerating(…)` → `Layer`) with ref-based config, iteration counter, reset + wake so long sleeps shorten after reset.

## Non-goals (v1 of this plan)

- Changing **`QueueResource`** internals (only if needed for clearer
  `ProcessGroup` integration — defer unless required).
- Top-level multi-host **`ProcessManager`** (see [08](./08-process-manager-future.md)).
- **`Process` as a `Context.Tag` service** for cross-process control (future).
- **Backward compatibility** with old `Process.make({ crons, effect })` — breaking change is acceptable; document in changelog / migration note.

---

## Mental model

| Concept | Responsibility |
| ------- | -------------- |
| **Supervisor** | What `ProcessGroup` forks: merges layers, runs schedule + polling drivers, ties into `ProcessStore`. |
| **Schedule service** | Arms / disarms polling (on/off, windows, cron-driven flips, custom effect). |
| **Polling service** | While armed: spacing between tick **attempts**, overlap policy, optional wake/reset hooks for presets. |
| **User `effect`** | One unit of work per **tick**; must not be hidden inside polling config. |
| **`ProcessGroup.stop`** | Interrupts supervisor (and thus schedule/polling drivers). **Distinct** from “disarm” (no new ticks; in-flight policy is a **locked default** — see Phase 0). |

**One-line doc string:** *Schedule arms the repeat loop; polling is how fast it fires while armed.*

---

## Public API (normative)

### `Process.make` (required vs optional)

**Required fields**

- `name: string`
- `effect: Effect.Effect<void, E, R>` (exact error/success typing as implemented;
  `void` success is acceptable if documented.)

**Optional fields** (each is a **`Layer`** that provides the corresponding tag)

- `polling?: Layer.Layer<Polling, never, RPoll>`
- `schedule?: Layer.Layer<Schedule, never, RSched>`  
  (If the public tag name collides with `effect/Schedule`, use e.g.
  **`ProcessSchedule`** — see Naming below.)

**Semantics**

- If `polling` / `schedule` **omitted**: the **supervised** program built by
  `Process` **still requires** those services in its environment; caller must
  **`Layer.provideMerge`** at `ProcessGroup` fork time or app root.
- If **provided** on `make`: library **`Effect.provideMerge`** those layers when
  building the forked effect so outer `R` does not include them.

### Optional pipe (must mirror optional fields)

```ts
Process.make({ name, effect })
  .pipe(Process.providePolling(layer), Process.provideSchedule(layer))
```

Implementation: store layers on the `Process` handle; merge at the same point
as inline `polling` / `schedule`.

### `Process` handle shape

- `name`
- `type` — keep a discriminator if `ControlService` / HTTP still needs it;
  value TBD (`"managed"` / `"process"` / etc.).
- `effect: Effect<void, never, R>` — **supervised** long-running program
  (includes internal schedule + polling wiring + analytics).
- `getStatus` — returns structured details (see Status section).
- **`runImmediately` / `tickNow`** — one entry for “run work outside normal
  spacing”; **exact semantics locked in Phase 0** (e.g. only when armed vs
  force single tick).

### Exported building blocks

- **Tags:** `Polling`, and schedule gate tag (final name: **`ProcessSchedule`**
  if `Schedule` is reserved for `effect`).
- **Helpers:** `Polling.layer`, `Polling.accelerating`, `Schedule.cronLayer` /
  `ProcessSchedule.cronLayer`, `Schedule.custom`, etc. — all return **`Layer`**
  or documented `Layer`-ready values.
- **Types:** e.g. `ProcessRequirements<P>`, status result type replacing
  cron-only `ScheduledProcessDetails` where needed.

---

## Naming (normative)

- Avoid exporting a public tag named **`Schedule`** if it collides with
  `import { Schedule } from "effect"` in consumer code. Prefer
  **`ProcessSchedule`** or **`PollGate`** for the arm/disarm service **name**
  (implementation can still use Effect `Schedule` internally for cron or
  spacing).

- **`Polling`** is the cadence/overlap (and preset) service name unless a
  clearer name is chosen before Phase 1; document renames in this file if they
  change.

---

## Architecture (normative)

### Supervisor

1. `ProcessGroup` creates `Scope`, forks **`process.effect`** into it (as today).
2. Built `process.effect` merges optional `polling` / `schedule` layers from
   `make` / `provide*` at the supervisor boundary.
3. **Implemented shape (single fiber):**
   - **Outer loop** — wait until the schedule gate is **armed**. While disarmed,
     interruptible sleep follows `status.nextScheduleTransition` when present
     (clamped), otherwise a capped fallback poll (configuration-level fallback),
     default 5s, minimum 100ms). Uses runtime **`Clock`** for “now”.
   - **Inner loop** — while **armed**: `Polling.awaitNextTick` (wakeable cadence),
     one tracked user **`effect`**, `Polling.afterTick`; if the gate reads **disarmed**,
     exit inner and return to the outer loop (no `ProcessGroup.stop` — the fiber
     stays attached until interrupt).
4. **Schedule driver:** for `ProcessSchedule.cronMatch`, a scoped fiber recomputes
   armed + transition refs on `sampleInterval` using the same **`Clock`** as the
   supervisor’s idle sleep (wall-clock alignment in production; `TestClock` when provided).

**Behavior invariant:** gate off ⇒ no new scheduled ticks; gate on ⇒ polling
cadence applies between ticks.

### Overlap

- Default **`serial`** (mutex): next tick waits for previous **`effect`**
  completion unless spec says otherwise.
- Optional **`concurrent`** via `Polling` service config.

### Stop / disarm / in-flight

| Action | Meaning |
| ------ | ------- |
| **Disarm** (schedule) | No new scheduled ticks; supervisor **waits** (idle sleep) until armed again; **in-flight** tick may still complete. |
| **`ProcessGroup.stop`** | Interrupt supervisor; polling/schedule fibers end; **in-flight user `effect`** per locked policy (interrupt vs join / timeout). |

These policies **must** be fixed in Phase 0 and reflected in tests and JSDoc.

### Accelerating poll (preset)

- Formula: `delay(n) = min + (max - min) * e^(-k * n)` with live multiplier on
  `k` (or equivalent) read from **refs** on each step.
- **Config ref** — max, min, decay; **iteration ref** — drives `n`; **reset**
  sets `n` to zero and **signals wake** so a long sleep does not ignore reset.
- Delivered as **`Polling.accelerating({ … }) → Layer`** (or `Layer.scoped` that
  allocates refs) — not a separate product type.

### Analytics

- Reuse **`ProcessStore`** append patterns from current `Process.ts` for tick
  completion (success / fail / interrupt as today’s semantics allow).
- Align event shape with existing analytics consumers where possible; extend
  only when necessary.

### Status (`getStatus`)

Expose at minimum concepts that are knowable without lying:

- Whether **armed** (or last known gate state).
- **Next poll** intent when computable (`Option`).
- **Next schedule transition** when computable (`Option`); cron-backed schedule
  can fill this; fully custom may return `none` / unknown.

---

## `ProcessGroup` changes (normative)

- **`startProcess`:** before fork, **`Effect.provideMerge`**:
  - layers baked into `Process`, **plus**
  - optional **`processLayers` / `layerFor(name)`** if the group API gains a
    hook for per-process ambient layers (recommended when multiple processes
    need different `Polling` instances).

- **`ProcessEffectRequirements`:** derived from new supervised `effect` `R`.

- **`runProcessImmediately` / control “now”:** behavior must match locked spec
  for **`tickNow`** (armed-only vs force tick).

- **Status / list endpoints:** updated for new detail fields; remove reliance on
  cron-only fields where obsolete.

---

## `ControlService` & CLI

- Update handlers for new status JSON.
- Document **`now`** command semantics vs arm/disarm.

---

## Implementation phases (checklist)

### Phase 0 — Locks (complete before coding supervisor)

- [ ] Public tag names (`Polling`, `ProcessSchedule` or chosen alternatives).
- [ ] **Stop** vs **disarm** vs **in-flight** defaults.
- [ ] **Overlap** default (`serial`).
- [ ] **`runImmediately` / `tickNow`** when disarmed.

### Phase 1 — Tags & presets

- [ ] `src/Polling.ts` (or split files): tag, interface, `layer`, accelerating preset, tests for curve + reset + wake.
- [ ] `src/ProcessSchedule.ts` (or chosen name): tag, cron + custom layer helpers, tests for arm/disarm.

### Phase 2 — `Process` supervisor

- [ ] Rewrite `src/Process.ts`: `Process.make`, optional layers, `provide*` pipe, supervised program, `getStatus`, store integration.

### Phase 3 — `ProcessGroup` + control

- [ ] Update `src/ProcessGroup.ts` (requirements, fork-time merge, status, immediate run).
- [ ] Update `src/ControlService.ts` / CLI.

### Phase 4 — Tests & example

- [ ] `test/process.test.ts` + new cases (matrix below).
- [ ] `examples/example.ts` — at least one **cron schedule + fixed polling**; optional **accelerating** snippet.

### Phase 5 — Ship prep

- [ ] JSDoc on public API.
- [ ] `CHANGELOG.md` / migration note for breaking `Process.make`.
- [ ] **`changeset`** for package release (required before publish).

---

## Testing matrix (minimum)

| Case | Expect |
| ---- | ------ |
| Inline `polling` + `schedule` on `make` | Ticks occur per cadence when armed; store records ticks. |
| Omitted layers + `provideMerge` at fork | Same as above; types require outer layers. |
| Disarmed | No new ticks (and store / probe matches locked policy). |
| `TestClock` | Cadence advances; accelerating delays shrink with `n`. |
| Reset + wake | After reset, wait until next tick ≤ configured max post-reset. |
| `stopProcess` | Supervisor ends; in-flight matches Phase 0 policy. |
| `runImmediately` / control `now` | Matches Phase 0 spec. |

---

## Risks & mitigations

| Risk | Mitigation |
| ---- | ---------- |
| `effect/Schedule` name clash | Public tag **`ProcessSchedule`** (or similar). |
| Multiple processes, same tag | Per-process **`provideMerge` at fork** or `layersByName` on group. |
| `getStatus` inaccurate for custom schedule | Return **`Option` / unknown**; do not fabricate cron fields. |

---

## QueueResource

**Do not change** unless a concrete `ProcessGroup` integration improvement is
identified; then minimal diff only.

---

## Drift control

1. **Implement only what this file specifies** unless this file is updated
   first.
2. Any API or behavior change during implementation **must** be reflected here
   in the same PR (or immediately after in a doc-only follow-up).
3. **04** and **05** are not authoritative for Process v2 runtime; **09** is.
