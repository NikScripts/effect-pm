# State Restructure & Reconciler Model

## Overview

The current `ProcessManagerState` is organized by property — separate maps for processes, statuses, fibers, etc. The new model reorganizes around the process itself, so a full picture of any process is a single lookup.

This restructure is a prerequisite for the reconciler, schedule switching, and the deploy-time peer coordination described in the deploy guide.

---

## Current Shape (to be replaced)

```ts
interface ProcessManagerState {
  processes: Map<string, Process>
  statuses: Map<string, Status>
  fibers: Map<string, Fiber>
  // ...
}
```

Every read requires cross-map joins. Adding new per-process fields means adding new maps.

---

## New Shape

```ts
interface ProcessManagerState {
  [name: string]: ProcessEntry
}
```

`ProcessEntry` is the full per-process record. See `05-process-entry-shape.md` for the complete shape. At a high level it contains:

- **Identity** — id, description, tags, timestamps
- **`status`** — a single combined/derived status covering both lifecycle and execution state (see Status section below)
- **`schedule`** — active schedule key, history, switch count, and per-schedule runtime state
- **`effect`** — execution state: running flag, timing, error history, run counts
- **`target` / `live`** — the two-state reconciler model
- **`metadata`** — user-set, observable, serializable
- **Process lifetime** — start/stop/restart timestamps and counts
- **`handoff`** — optional deploy-time coordination state
- **`_internal`** — PM machinery: the Effect value, fiber, scope, schedule configs, lifecycle status, handoff handlers. Not serializable, not exposed publicly.

`target` and `live` are the two-state model the reconciler operates on. Everything else is operational metadata.

---

## Target vs Live

The reconciler's job is to converge `live` toward `target`. The process itself is never responsible for reconciliation.

```ts
// both target and live share this shape
interface ProcessReconcilerState<S extends string> {
  scheduleKey: S | null
  enabled: boolean
  metadata: Record<string, unknown>
}
```

A diff between `target` and `live` tells the reconciler exactly what changed and what action to take. If there is no diff, reconciliation is a no-op.

---

## Reconciler Rules

1. **On any state change** → attempt reconciliation immediately
2. **If `isRunningEffect` is true** → skip; reconciliation will run automatically after the effect completes
3. **After every effect run** → always reconcile unconditionally — no explicit pending flag needed

Multiple state changes that arrive during a long-running effect are coalesced: by the time the effect finishes, `target` reflects the latest desired state, and reconciliation applies it in a single pass.

### Pseudocode

```ts
const reconcile = (name: string) =>
  Effect.gen(function* () {
    const entry = yield* getEntry(name)

    if (entry.isRunningEffect) return // will reconcile post-run

    const diff = computeDiff(entry.target, entry.live)
    if (!diff) return // already converged

    yield* applyDiff(name, diff)
  })
```

`applyDiff` handles the actual fiber lifecycle changes — stop, rebuild, fork — described in the schedule switching doc.

---

## Migration Notes

- All internal reads of `ProcessManagerState` will need updating to the new per-process lookup pattern
- The public API surface (how users interact with the PM) is a separate concern and should not necessarily mirror the internal state shape
- `_internal.effectRunning` is set by the PM around each effect execution — the process fiber should never touch it directly
- `status` (the combined/public field) is always derived — never set directly. It is computed from `_internal.lifecycleStatus` and `_internal.effectRunning`
- See `05-process-entry-shape.md` for the full `ProcessEntry` type
