# 05 — State & reconciler (planned)

## Goal

Replace ad-hoc maps inside the orchestrator with a single model:

- `Record<ProcessId, ProcessEntry>` with **target** vs **live** reconciliation.
- Pure `computeDiff(target, live)` and effectful `applyDiff(processId, diff)`.
- Reconciliation after mutations and post-run where required.

## Status

Not implemented. `ProcessGroup` still uses the previous internal map layout.

## Exit criteria (when done)

- No lifecycle transitions except through the reconciler path.
- Tests for diff/apply, schedule key no-ops, deferred switches during active runs.
