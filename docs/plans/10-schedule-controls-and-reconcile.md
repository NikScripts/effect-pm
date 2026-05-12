# 10 — Schedule controls, reconcile, and removal cleanup (next beta)

## Status

**Planned (target: next beta).**  
This document defines the schedule-management UX and runtime behavior required to:

1. inspect and mutate schedule entries ergonomically,
2. remove entries safely (pending and running cleanup),
3. sync runtime schedule state with database state without drift.

When implemented, this plan becomes normative for schedule-control APIs and behavior.

---

## Problem statement

Current schedule controls are good for simple append/replace flows but incomplete for real operations:

- No first-class **targeted deletion** or **reconcile** API for DB sync.
- No explicit behavior contract for:
  - entries removed while waiting for trigger,
  - entries removed while already running.
- No unified way to use the same controls in both:
  - `Process.make({ schedule: (controls) => ... })` initializer, and
  - the process `effect` body itself.

Result: easy to accidentally drift from DB truth or leave stale runtime work alive longer than intended.

---

## Goals

1. **Single, ergonomic control surface** for schedule mutation and inspection.
2. **Deterministic cleanup semantics** for removed entries:
   - cancel pending sleepers,
   - naturally stop running instances.
3. **Database sync first-class UX**:
   - one operation to upsert current rows and prune stale runtime entries.
4. **Same controls everywhere**:
   - available in schedule initializer and in process effect.
5. Keep public API concise and easy to type.

## Non-goals

- Distributed multi-node schedule consensus.
- External queue/storage integration inside the core runtime (DB sync orchestration remains app-level).
- Shims for pre-plan control names/shapes.

---

## Core model

### Entry identity

`ProcessScheduleEntry` uses a stable `id` for identity:

- `id` is the key used for mutation, reconciliation, and cleanup correlation.
- `startAt` and `stopAt` define runtime timing behavior.

```ts
interface ProcessScheduleEntry {
  readonly id: string;
  readonly startAt: Date;
  readonly stopAt: Option.Option<Date>;
}
```

### Why required `id`

DB sync and deterministic deletion require stable identity.  
Without identity, “remove stale entry” degrades into fragile timestamp matching.

---

## Public API (normative)

## `ProcessScheduleService`

```ts
interface ProcessScheduleService {
  readonly entries: Effect.Effect<ReadonlyArray<ProcessScheduleEntry>, never, never>;
  readonly changed: Effect.Effect<void, never, never>;

  readonly get: (id: string) => Effect.Effect<Option.Option<ProcessScheduleEntry>, never, never>;
  readonly has: (id: string) => Effect.Effect<boolean, never, never>;

  readonly set: (
    entries: ReadonlyArray<ProcessScheduleEntry>,
  ) => Effect.Effect<void, never, never>;
  readonly add: (entry: ProcessScheduleEntry) => Effect.Effect<void, never, never>;
  readonly upsert: (entry: ProcessScheduleEntry) => Effect.Effect<void, never, never>;

  readonly remove: (id: string) => Effect.Effect<boolean, never, never>;
  readonly removeMany: (ids: ReadonlyArray<string>) => Effect.Effect<number, never, never>;
  readonly clear: Effect.Effect<void, never, never>;

  readonly reconcile: (
    next: ReadonlyArray<ProcessScheduleEntry>,
  ) => Effect.Effect<{
    readonly added: ReadonlyArray<string>;
    readonly updated: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
    readonly unchanged: ReadonlyArray<string>;
  }, never, never>;
}
```

### Control alias in `Process`

`ProcessScheduleControls` is the same shape exposed to users from both:

- schedule initializer function arg,
- process effect context accessor.

```ts
type ProcessScheduleControls = Pick<
  ProcessScheduleService,
  | "entries"
  | "get"
  | "has"
  | "set"
  | "add"
  | "upsert"
  | "remove"
  | "removeMany"
  | "clear"
  | "reconcile"
>;
```

---

## Access points (normative)

## 1) `schedule` initializer controls

```ts
Process.make({
  name: "my-proc",
  schedule: ({ reconcile }) => reconcile(initialEntriesFromDb),
  effect: ...
})
```

## 2) effect-time controls

Add:

```ts
Process.scheduleControls: Effect.Effect<ProcessScheduleControls, never, never>
```

This is available only inside a running process context and supports the exact same operations as initializer controls.

```ts
const controls = yield* Process.scheduleControls;
yield* controls.remove("stale-entry");
```

---

## Runtime behavior for removal (normative)

Given an entry `id` that is removed by `remove`, `removeMany`, `set`, `clear`, or `reconcile`:

1. **Pending (not triggered yet)**  
   - If there is a sleeper fiber waiting for `startAt`, interrupt it immediately.
   - Remove pending bookkeeping for that `id`.
   - No instance is spawned.

2. **Running instance**  
   - Instance checks whether its `id` still exists before each poll wait and after wake.
   - If missing, instance exits naturally (same lifecycle semantics as disarm/closed window).
   - No forced hard interrupt required for normal removal path.

3. **Completed entries**  
   - If already completed, removal only affects future reconciliation/state maps.

### Equivalent operations

- `clear` is equivalent to removing all ids.
- `set(next)` is equivalent to:
  - remove ids not in `next`,
  - upsert ids in `next`.
- `reconcile(next)` follows the same semantics and emits a diff result.

---

## Database sync UX (normative)

Primary pattern:

```ts
const rows = yield* loadScheduleRowsFromDb();
const next = rows.map(toProcessScheduleEntry);
const diff = yield* controls.reconcile(next);
yield* Effect.logDebug(`schedule sync diff: ${JSON.stringify(diff)}`);
```

### Guarantees

- Runtime schedule converges to DB truth after each reconcile call.
- Entries present only in runtime are auto-deleted.
- Deletion triggers pending/running cleanup semantics above.

### Recommended polling/event loop

- Run a periodic sync effect (or event-driven sync) separate from business ticks.
- Keep transformation `DB row -> ProcessScheduleEntry` pure and deterministic.
- Log reconcile diff for operations visibility.

---

## Example snippets

## A) Initial bootstrap + periodic sync in effect

```ts
const proc = Process.make({
  name: "sports-poller",
  schedule: ({ reconcile }) =>
    Effect.gen(function* () {
      const initial = yield* loadDbSchedule();
      yield* reconcile(initial.map(toEntry));
    }),
  effect: Effect.gen(function* () {
    const controls = yield* Process.scheduleControls;
    const latest = yield* loadDbSchedule();
    yield* controls.reconcile(latest.map(toEntry));
    // business work...
  }),
});
```

## B) Explicit remove from process logic

```ts
const controls = yield* Process.scheduleControls;
const removed = yield* controls.remove(`match-${matchId}`);
if (removed) {
  yield* Effect.logInfo(`removed schedule entry match-${matchId}`);
}
```

---

## Implementation checklist (next beta)

### Phase 1 — Service + controls

- [ ] Extend `ProcessScheduleService` with `get`, `has`, `upsert`, `remove`, `removeMany`, `reconcile`.
- [ ] Keep `entries`, `changed`, `set`, `add`, `clear` semantics.
- [ ] Define/align `ProcessScheduleControls` to the same surface.

### Phase 2 — Process runtime cleanup

- [ ] Key pending/running maps by entry `id`.
- [ ] On schedule mutation reconciliation, interrupt pending sleepers for removed ids.
- [ ] Running instance guard checks `has(id)` and exits naturally if removed.
- [ ] Ensure `activeInstances` mirror remains accurate through all removal paths.

### Phase 3 — Effect-side access

- [ ] Add `Process.scheduleControls` accessor in process context.
- [ ] Provide controls in both initializer and tracked user effect contexts.
- [ ] Maintain `Process.currentScheduleId` behavior.

### Phase 4 — Docs and examples

- [ ] Update `docs/PROCESS-API.md` schedule section with new control methods.
- [ ] Add a DB reconcile example to `examples/`.
- [ ] Update schedule/group narrative docs for deletion semantics.

### Phase 5 — Tests

- [ ] `remove(id)` cancels pending trigger fiber.
- [ ] Removing running entry causes natural instance exit.
- [ ] `reconcile(next)` returns correct diff and prunes stale entries.
- [ ] Controls accessible in initializer and process effect.
- [ ] Full typecheck + test suite pass.

### Phase 6 — Ship prep

- [ ] Changelog notes for schedule-control API additions and naming.
- [ ] Add changeset for beta release.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Missing/unstable ids from DB | Treat `id` as required contract; validate at boundaries. |
| Over-sync churn | Prefer `reconcile` with diffing and sorted normalization to avoid no-op updates. |
| Unexpected stop timing for running entries | Document “natural stop on next guard check” and test with `TestClock`. |

---

## Acceptance criteria

This plan is complete for beta when all are true:

1. Users can inspect and mutate schedules by id without manual list diff logic.
2. Removing entries reliably cancels pending runs and naturally ends running ones.
3. `reconcile` enables one-call DB-to-runtime convergence with stale auto-deletion.
4. Same schedule controls are available in initializer and effect contexts.
5. Docs/examples/tests reflect and enforce this behavior.
