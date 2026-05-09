# Implementation Order — Consistency-First vNext

## Scope

This plan replaces piecemeal evolution with one coherent architecture for effect-pm:

- Internal process runtime is centered on `ProcessEntry` + reconciler semantics.
- Process scheduling, control, and runtime metadata follow one model.
- `ExecutionHistory` is replaced by a unified analytics/storage service (`ProcessStore`).
- Queue APIs are standardized under current project naming (`QueueResource`), not legacy `ResourcePool`.

This plan intentionally excludes deploy coordination and handoff concerns for now.

---

## Consistency Contract (must hold throughout implementation)

1. **One runtime source of truth**
   - `ProcessManagerState` becomes `Record<string, ProcessEntry>`.
   - No parallel map-by-field state (`statuses`, `fibers`, `startTimes`, etc.).

2. **One reconciliation flow**
   - State-changing intent mutates `target`.
   - Reconciler converges `live` toward `target`.
   - Process fibers never self-manage lifecycle transitions.

3. **One analytics/storage abstraction**
   - Replace `ExecutionHistory` with `ProcessStore`.
   - All process and queue lifecycle analytics flow through this service.

4. **One queue vocabulary**
   - Method names: `bump`, `add`, `defer`.
   - Persistence hooks live under `storage`, not top-level `cache`/`refill`.

5. **One style of public API surface**
   - Use explicit, effect-friendly names.
   - Prefer stable tagged errors and typed records over ad hoc shapes.

---

## Workstream Order

## 1) State Restructure (blocking foundation)

Convert PM internals to per-process entries before introducing behavior changes.

### Required outcomes

- Replace map-by-property state with `ProcessEntry` map.
- Introduce entry sections:
  - identity
  - status
  - schedule
  - effect runtime
  - `target` and `live`
  - metadata
  - `_internal`
- Update all internal reads/writes to entry-centric helpers.
- Keep externally visible behavior equivalent during this phase.

### Exit criteria

- No internal feature reads from old `statuses`/`fibers` maps.
- All process lifecycle and status data are discoverable from one entry lookup.

---

## 2) Process Type Variants and Schedule Key Typing

Define the process model variants after state is stable.

### Required outcomes

- Introduce:
  - base process (no schedule)
  - single-schedule process
  - multi-schedule process
- Finalize schedule config contract.
- Infer schedule key union from config and thread through control types.

### Exit criteria

- Invalid schedule key switches fail at compile time.
- Single and multi schedule variants share consistent semantics.

---

## 3) Reconciler Core

Build pure diffing and controlled runtime application.

### Required outcomes

- Add `computeDiff(target, live)` pure function.
- Add `applyDiff(processId, diff)` for runtime transitions.
- Reconcile:
  - after relevant state mutations
  - after every effect run
- Respect effect-running gate to avoid unsafe mid-run interruption.

### Exit criteria

- Runtime transitions are reconcilable and testable independently.
- Same-target updates are no-op and do not restart process fibers.

---

## 4) ProcessControl and Schedule Switching

Expose a narrow control API used from process effects.

### Required outcomes

- Introduce `ProcessControl<ScheduleKeys>` service.
- Minimum control surface:
  - `switchSchedule`
  - `sleepUntil`
  - `sleepFor`
  - `clearSleep`
  - `setMetadata`
- Ensure control calls mutate `target` only; reconciler applies changes.

### Exit criteria

- Process effects can request schedule/metadata changes without direct PM mutation.
- Same-schedule switches produce no lifecycle churn.

---

## 5) ProcessStore (ExecutionHistory replacement)

Introduce unified analytics and storage service used across effect-pm.

### Required outcomes

- Define `ProcessStore` interface covering:
  - execution events
  - lifecycle events
  - schedule switch events
  - queue storage/event operations
- Add first implementation: `ProcessStore.memory()`.
- Add default durable implementation: `ProcessStore.file()`.
- Route process writes from PM runtime into `ProcessStore`.
- Remove `ExecutionHistory` from PM core paths.

### Exit criteria

- Process analytics are no longer tied to process-only cron history.
- PM can run without `ExecutionHistory` service.

---

## 6) QueueResource Storage Overhaul

Move queue persistence and lifecycle analytics to unified store contracts.

### Required outcomes

- Update queue API names:
  - `next` -> `bump`
  - `deffered` -> `defer`
- Move persistence config to:
  - `storage.onEnqueued`
  - `storage.onEffectComplete`
  - `storage.onForkComplete`
  - `storage.onEmpty`
  - `storage.onMaxRetries`
- Add keyed behavior options:
  - `getKey`
  - `skipDuplicates`
  - `maxRetries`
  - `historyLimit`
  - top-level `onMaxRetries`
- Define and use records:
  - `EnqueuedRecord`
  - `EffectCompleteRecord`
  - `ForkCompleteRecord`
  - `QueueRecord`
- Ensure `exit` remains hook-visible but is stripped before persistence.

### Exit criteria

- Queue lifecycle hooks are powered by `ProcessStore`.
- Naming and config shape are aligned with project conventions.

---

## 7) Prisma Store and Setup Tooling

Add first-class persistent analytics backend for production workloads.

### Required outcomes

- Implement `PrismaProcessStore` in package export surface.
- Ship Prisma schema fragments/models and recommended indexes.
- Add setup command: `npx effect-pm add prisma`.
- Include idempotency and schema-path detection behavior.

### Exit criteria

- Teams can adopt persistent analytics storage with minimal setup friction.

---

## Testing Strategy (mandatory for every phase)

Testing is not a final step. It is part of each phase gate.

## Per-PR minimum

- Add/update unit tests for every changed pure function or transition rule.
- Add/update integration tests for stateful effects and service wiring.
- Run targeted tests for touched modules before and after refactors.

## Required suites by phase

1. **State restructure**
   - state construction and update invariants
   - status derivation correctness

2. **Process variants**
   - compile-time typing expectations for schedule keys
   - runtime behavior parity for single schedule

3. **Reconciler**
   - diff correctness table tests
   - no-op behavior
   - safe defer while effect is running

4. **ProcessControl**
   - control method target mutations
   - post-run reconciliation behavior

5. **ProcessStore**
   - write/read round trips by event type
   - ordering/limit behavior
   - serialization expectations

6. **QueueResource overhaul**
   - priority ordering with new names
   - key/history duplicate and retry behavior
   - storage hook invocation and data stripping

7. **Prisma**
   - integration tests behind opt-in setup
   - schema idempotency checks for setup command

## Verification cadence

- Run targeted test file(s) after each completed sub-step.
- Run broader module suite after each phase.
- Run full test suite at phase completion checkpoints.

---

## Definition of Done for This Plan

- `ExecutionHistory` is replaced by `ProcessStore` in core runtime behavior.
- Process runtime and queue runtime use one analytics/storage story.
- Queue naming and config surface are consistent (`bump/add/defer`, `storage` hooks).
- Reconciler semantics are explicit, tested, and observable.
- Docs reflect current architecture, not legacy or mixed models.
