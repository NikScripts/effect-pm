# Consistency Architecture and Test Plan

## Purpose

This document is the quality reference for the vNext consistency rebuild.
It complements `00-implementation-order.md` and defines:

- canonical naming,
- service boundaries,
- architectural invariants,
- and mandatory test gates for every implementation phase.

The intent is to prevent further drift from opportunistic one-off changes.

---

## Scope

Included in this cycle:

- process runtime state reshape (`ProcessEntry` + reconciler),
- process variant typing and control surface,
- `ProcessStore` as a unified analytics/storage service,
- `QueueResource` storage integration and queue lifecycle records.

Explicitly out of scope:

- deploy coordination,
- deployment handoff.

---

## Canonical Naming (non-negotiable)

## Process runtime

- `ProcessDefinition`: user-facing process config.
- `ProcessEntry`: runtime state for one process.
- `ProcessManagerState`: `Record<string, ProcessEntry>`.
- `ProcessControl`: effect-scoped control API for schedule/metadata/sleep.

## Queue runtime

- Public name remains `QueueResource`.
- Priority methods:
  - `bump` (high)
  - `add` (normal)
  - `defer` (low)
- Storage behavior lives under `storage` config object.

## Unified analytics/storage

- `ProcessStore` is the shared service across process + queue concerns.
- `ExecutionHistory` is legacy and is phased out from core runtime wiring.

---

## Architectural Invariants

These rules are required and must be tested directly:

1. **Single process lookup**
   - A full process runtime view is available from one `ProcessEntry`.

2. **Target/live reconciliation**
   - Mutations express intent via `target`; reconciler converges `live`.

3. **No direct lifecycle mutation from effects**
   - Effects request changes through `ProcessControl` only.

4. **Serializable persistence boundary**
   - Hook-visible runtime extras are stripped before persistence writes.

5. **Queue API consistency**
   - No public `next` / `deffered` usage in vNext APIs.

6. **One analytics substrate**
   - Process and queue event records flow through `ProcessStore`.

---

## ProcessStore Contract

## Process-level writes and queries

- `recordExecution`, `getExecutions`
- `recordScheduleSwitch`, `getScheduleHistory`
- `recordLifecycleEvent`, `getLifecycleHistory`

## Queue-level writes and queries

- `pool.onEnqueued`
- `pool.onEffectComplete`
- `pool.onForkComplete`
- `pool.onMaxRetries`
- `pool.getPending`

## Query behavior

- `QueryOpts.limit` caps returned rows after ordering.
- `QueryOpts.before` and `QueryOpts.after` are strict bounds.
- Ordering for time-series reads is newest-first.

---

## Data Model Requirements

## Process records

- `ExecutionRecord`
  - includes process id, schedule key, timing, status, optional error and metadata.
- `ScheduleSwitchEvent`
  - includes process id, from/to schedule keys, switched timestamp.
- `LifecycleEvent`
  - includes process id, lifecycle event tag, occurred timestamp, optional metadata.

## Queue records

- `EnqueuedRecord<T>`
- `EffectCompleteRecord<T, R, E>`
- `ForkCompleteRecord<T, R, E>`
- `QueueRecord<T, R, E>` union

Queue record notes:

- effect/fork completion records extend enqueue record context.
- storage writes should not depend on non-serializable runtime fields.

---

## Phase Gates and Required Tests

## Phase A: `ProcessEntry` state reshape

Implementation:

- migrate PM state to entry map,
- derive combined status from internal state.

Tests:

- constructor/derivation unit tests,
- PM lifecycle integration smoke tests.

## Phase B: process variants and schedule keys

Implementation:

- unscheduled, single-schedule, and multi-schedule variants,
- typed schedule key propagation.

Tests:

- compile-time key rejection tests,
- runtime schedule initialization tests.

## Phase C: reconciler

Implementation:

- pure `computeDiff`,
- effectful `applyDiff`,
- trigger points on mutation and post-run.

Tests:

- table-driven diff coverage,
- no-op/switch/enable-disable integration tests,
- coalescing behavior for mid-run target changes.

## Phase D: `ProcessControl`

Implementation:

- context service for:
  - `switchSchedule`
  - `sleepUntil`
  - `sleepFor`
  - `clearSleep`
  - `setMetadata`

Tests:

- method-level unit behavior,
- effect-integration tests with reconciliation.

## Phase E: `ProcessStore` baseline

Implementation:

- memory + file store implementations,
- PM event wiring to store.

Tests:

- ordering/filter/limit tests per record type,
- persistence tests for file store,
- integration tests validating PM writes.

## Phase F: `QueueResource` storage overhaul

Implementation:

- move to `storage.*` hooks,
- add `getKey`, `skipDuplicates`, `maxRetries`, `historyLimit`, `onMaxRetries`,
- queue `fill` helper for `onEmpty`.

Tests:

- history loading and duplicate suppression,
- retry-limit short-circuit behavior,
- hook ordering and payload-shape tests.

## Phase G: Prisma store

Implementation:

- Prisma models/indexes,
- `PrismaProcessStore`,
- setup command safety/idempotency.

Tests:

- setup idempotency tests,
- store parity tests vs memory/file semantics.

---

## Test Cadence Requirements

For every PR:

- run targeted tests for touched modules immediately after implementation,
- rerun affected integration tests before finalizing,
- run full suite at major phase boundaries.

No phase is complete unless:

- required tests are present and passing,
- invariants for that phase are explicitly verified.

---

## Documentation Completion Checklist

- [ ] README aligned with vNext process + queue + store model
- [ ] examples updated to new API naming (`bump`/`defer`, `ProcessStore`)
- [ ] changelog entries grouped by architecture phases
- [ ] no stale docs presenting deploy/handoff as current track scope
# Consistency Architecture and Test Plan
# Consistency Architecture and Test Plan

## Purpose

This document is the implementation-quality reference for the vNext rebuild.
It defines:

- final naming and architectural direction,
- service responsibilities,
- sequencing constraints,
- and test requirements that must be satisfied before each phase is considered done.

The goal is to prevent partial, local optimizations that reintroduce drift.
Every implementation change should trace back to this document and `00-implementation-order.md`.

---

## Non-goals

This cycle explicitly does not include:

- deploy-time peer coordination,
- deploy handoff protocols,
- migration compatibility shims for old external users.

Those topics can be revisited in a dedicated future track after core consistency work lands.

---

## Canonical Domain Model

## Process runtime

- `ProcessDefinition` describes user config.
- `ProcessEntry` describes live runtime state for one process.
- `ProcessManagerState` is `Record<ProcessId, ProcessEntry>`.
- Runtime transitions follow `target` (desired) and `live` (actual) state.
- Reconciler is the only mechanism that mutates runtime toward desired state.

## Queue runtime

- Canonical name stays `QueueResource`.
- Priority API is:
  - `bump` (high)
  - `add` (normal)
  - `defer` (low)
- Queue persistence and analytics hooks are grouped under `storage`.

## Unified storage and analytics

- `ExecutionHistory` is replaced by `ProcessStore`.
- `ProcessStore` receives writes from:
  - process effect execution completion,
  - lifecycle transitions,
  - schedule switches,
  - queue enqueue/effect/fork/retry events.

---

## Architectural Invariants

These are hard constraints and should be tested directly:

1. **Single lookup completeness**
   - A process runtime snapshot should be available from one `ProcessEntry` lookup.

2. **No ad hoc lifecycle mutation**
   - Effects and queue workers cannot mutate lifecycle state directly.
   - They request changes through typed control APIs.

3. **Reconciliation determinism**
   - For equal `target` and `live`, diff is no-op.
   - Repeated reconciliation on converged state is idempotent.

4. **Serializable persistence boundary**
   - Hook consumers may inspect rich runtime values.
   - Persisted records must strip non-serializable fields.

5. **Queue naming consistency**
   - New implementation must not expose legacy `next` or `deffered`.
   - All docs and examples use `bump` and `defer`.

6. **One analytics substrate**
   - Process/queue observability must not be split between multiple internal services.

---

## Phase-by-Phase Engineering Detail

## Phase A: Process entry reshape

### Implementation tasks

- Introduce `ProcessEntry` type module and constructor helpers.
- Replace parallel `Ref<Map<...>>` PM state refs with one entry state ref.
- Add status derivation helper from internal runtime flags.

### Quality gates

- Unit tests for entry constructors and derived status transitions.
- Integration test proving PM APIs still function with entry-backed state.

---

## Phase B: Process variant typing

### Implementation tasks

- Define process variant config union:
  - unscheduled
  - single schedule
  - multi schedule
- Infer schedule key unions from definitions.
- Thread schedule key type to control interface.

### Quality gates

- Type-level tests (compile constraints) for invalid key rejection.
- Runtime tests for schedule activation initialization.

---

## Phase C: Reconciler

### Implementation tasks

- Implement `computeDiff(target, live)` pure module.
- Implement `applyDiff(entry, diff)` effectful module.
- Trigger reconciliation:
  - on state mutation,
  - and after each process run.

### Quality gates

- Table-driven diff tests for all combinations.
- Integration tests for no-op, schedule switch, disable/enable, and metadata update.
- Regression test: changes during running effect are coalesced and applied post-run.

---

## Phase D: ProcessControl service

### Implementation tasks

- Introduce `ProcessControl` context service.
- Implement typed methods:
  - `switchSchedule`
  - `sleepUntil`
  - `sleepFor`
  - `clearSleep`
  - `setMetadata`
- Ensure calls mutate `target` and then request reconciliation.

### Quality gates

- Service-level tests for each control command.
- Integration tests for in-effect switching without direct PM coupling.

---

## Phase E: ProcessStore baseline

### Implementation tasks

- Define store records and query options.
- Implement `ProcessStore.memory()` with deterministic ordering.
- Implement `ProcessStore.file()` with append-safe writes and bounded queries.
- Wire PM execution/lifecycle/schedule writes to store.

### Quality gates

- Unit tests for record insertion and retrieval filters.
- File store tests for persistence across service recreation.
- Integration tests that process runs emit expected records.

---

## Phase F: QueueResource storage overhaul

### Implementation tasks

- Introduce queue record types:
  - `EnqueuedRecord`
  - `EffectCompleteRecord`
  - `ForkCompleteRecord`
  - `QueueRecord` union
- Introduce `storage` config object and service callback contracts.
- Add key/history support:
  - `getKey`
  - `skipDuplicates`
  - `maxRetries`
  - `historyLimit`
- Add queue `fill` utility for `storage.onEmpty`.

### Quality gates

- Tests for enqueue history loading and ordering.
- Tests for duplicate skip and max-retry short-circuit.
- Tests that `exit` is visible in hooks but absent in persisted records.

---

## Phase G: Prisma store

### Implementation tasks

- Add Prisma models for all event domains.
- Implement `PrismaProcessStore`.
- Add setup command for model injection and safety checks.

### Quality gates

- Schema generation/idempotency tests.
- Integration tests for write/read parity against memory/file semantics.

---

## Test Design Standards

## General standards

- Prefer deterministic tests (explicit time control where possible).
- Keep unit tests small and exhaustive for branchy logic.
- Use integration tests to validate wiring and lifecycle behavior.

## Effect-specific standards

- Use `@effect/vitest` live tests for runtime behavior.
- Keep environment provisioning explicit in each test.
- Avoid hidden shared mutable state across tests.

## Storage-specific standards

- Verify chronological ordering assumptions.
- Test limit/before/after filters together, not in isolation only.
- Add corruption and malformed data behavior tests for file store.

## Queue-specific standards

- Verify priority and fairness explicitly.
- Validate behavior under concurrent workers and throttling.
- Validate hook invocation ordering for enqueue/effect/fork lifecycle.

---

## Observability and Debugging Expectations

- All lifecycle transitions should be traceable via store events.
- Reconciler actions should emit debug logs with reason tags.
- Queue event records should include enough metadata to reconstruct event flow.

Recommended metadata fields:

- process id or queue id,
- event timestamp,
- active schedule key (if process),
- priority and key (if queue),
- operation result status.

---

## Documentation Completion Checklist

Before declaring this initiative complete:

- [ ] Public README updated to new queue naming and storage model
- [ ] API docs reference `ProcessStore` (not `ExecutionHistory`)
- [ ] Examples migrated to new process and queue surfaces
- [ ] Changelog sections grouped by architecture phase
- [ ] Internal plan docs contain no stale references to excluded deploy/handoff scope

---

## Release Discipline

- Ship in clear, phase-aligned PRs.
- Keep each PR test-complete for its slice.
- Add a changeset for every externally observable API or behavior change.

Suggested batching:

1. Types and state foundations
2. Reconciler and control runtime
3. Store replacement and PM wiring
4. Queue storage overhaul
5. Prisma and setup tooling
