# 11 — QueueResource v2: class-based service pattern + feature expansion

**Status:** Plan (implementation target for next beta)

**Replaces:** Current `QueueResource.make` factory pattern in `src/QueueResource.ts`.

**Breaking:** Yes. This is a full rewrite. Migration guide at bottom.

---

## 1. Motivation

### 1.1 `serviceNotAsClass`

The Effect language service diagnostic `serviceNotAsClass` enforces that `Context.Service` must be used as a **class declaration**, not assigned to a variable. The current `QueueResource.make` violates this:

```typescript
// CURRENT (triggers serviceNotAsClass):
const EmailQueue = QueueResource.make({ name: "email-queue", effect: ... });
// Internally: const service = Context.Service<...>(config.name);
```

### 1.2 Feature gaps (from plan 07)

Storage hooks, deduplication, retry policies, and observability are planned but not wired.

### 1.3 Behavioral issues (from testing notes)

- Worker busy-loop after `shutdown()`
- `pause()` not honored when workers are blocked in `Queue.take`
- Homegrown throttler when Effect ships `RateLimiter`
- Manual `Ref<Set<Fiber>>` when Effect ships `FiberSet`

---

## 2. Public API design

Three entry points sharing one internal engine:

### 2.1 `QueueResource.Service` — identity + default layer (primary)

Use when config is known at declaration time. The 90% case.

```typescript
class EmailQueue extends QueueResource.Service<EmailQueue, Email, void, SmtpError>()("email-queue", {
  effect: (email) => sendEmail(email),
  forkWith: (forked, item, q) => forked.pipe(Effect.catchAll(() => q.deferred(item))),
  concurrency: 5,
  throttle: { limit: 100, duration: Duration.minutes(1) },
}) {}

// EmailQueue IS the Context.Tag
// EmailQueue.layer is auto-generated (Layer.scoped under the hood)

const queue = yield* EmailQueue;
yield* queue.add(emails);
Effect.provide(EmailQueue.layer);
```

### 2.2 `QueueResource.Tag` — pure identity, no default layer

Use for shared contracts, library interfaces, dependency inversion.

```typescript
class JobQueue extends QueueResource.Tag<JobQueue, Job, JobResult, JobError>()("job-queue") {}

// No .layer — consumers must provide one:
const JobQueueLive = QueueResource.layer(JobQueue, { effect: ..., forkWith: ... });
```

### 2.3 `QueueResource.layer` — build a layer for any tag

Works with both `Service` and `Tag` classes. Use for tests, environment overrides, alternate implementations.

```typescript
// Override a Service's baked-in default:
const TestEmailLayer = QueueResource.layer(EmailQueue, { effect: mockSend, concurrency: 1 });

// Provide an implementation for a Tag:
const JobQueueProd = QueueResource.layer(JobQueue, { effect: processJob, concurrency: 20 });
```

### 2.4 Guidance

| Scenario | Use |
|----------|-----|
| Concrete queue, config known at declaration | `QueueResource.Service` |
| Abstract queue, implementation varies by consumer | `QueueResource.Tag` + `QueueResource.layer` |
| Tests / env-specific override | `QueueResource.layer(ExistingTag, altConfig)` |
| Full mock (no real processing) | `Layer.succeed(Tag, mockRef)` |

---

## 3. `QueueRef<Name, T, R, E>` — the service shape (unchanged interface)

The runtime handle returned from `yield* MyQueue`. Public API surface stays the same (with one spelling fix and additions):

```typescript
export interface QueueRef<_Name extends string, T, _R, _E = never> {
  // --- Enqueue (priority levels) ---
  readonly next: (item: T | readonly T[]) => Effect.Effect<void>;
  readonly add: (item: T | readonly T[]) => Effect.Effect<void>;
  readonly deferred: (item: T | readonly T[]) => Effect.Effect<void>;  // NOTE: spelling fix from "deffered"

  // --- Size / status ---
  readonly size: () => Effect.Effect<number>;
  readonly sizeByPriority: () => Effect.Effect<{ high: number; normal: number; low: number }>;
  readonly isEmpty: () => Effect.Effect<boolean>;
  readonly getCompleted: () => Effect.Effect<number>;

  // --- Lifecycle control ---
  readonly pause: () => Effect.Effect<void>;
  readonly resume: () => Effect.Effect<void>;
  readonly shutdown: () => Effect.Effect<void>;
  readonly restart: () => Effect.Effect<void>;
}
```

**Breaking changes to `QueueRef`:**
- `deffered` → `deferred` (typo fix)
- `_workers` internal field removed from public interface

---

## 4. Configuration (`QueueResourceConfig`)

### 4.1 Core processing (existing, retained)

```typescript
interface QueueResourceConfig<T, R, E, RFork, RItem, Name> {
  /** Per-item processor. */
  readonly effect: (item: T) => Effect.Effect<R, E, RItem>;

  /** Required when E ≠ never. Runs in a fork after each item. */
  readonly forkWith: /* conditional: required | optional based on E */;

  /** Max items in each priority queue. @default 50_000 */
  readonly capacity?: number;

  /** Concurrent workers. @default 5 */
  readonly concurrency?: number;

  /** Rate limiting. When omitted: no throttle. */
  readonly throttle?: { readonly limit: number; readonly duration: Duration.Duration };
}
```

### 4.2 Persistence (existing, retained)

```typescript
{
  /** Called when items are enqueued (before processing). */
  readonly cache?: (item: T | readonly T[], queue: QueueRef<Name, T, R, E>) => Effect.Effect<void, Error>;

  /** Called when all priority queues are empty. Refill from DB/cache. */
  readonly refill?: (queue: QueueRef<Name, T, R, E>) => Effect.Effect<void, Error>;
}
```

### 4.3 New: Deduplication

```typescript
{
  /** Extract a unique key from each item. Required for skipDuplicates. */
  readonly getKey?: (item: T) => string;

  /**
   * When true + getKey is set: items with a key already in the queue are silently dropped.
   * @default false
   */
  readonly skipDuplicates?: boolean;
}
```

### 4.4 New: Retry policy

```typescript
{
  /**
   * Max times to re-enqueue a failed item before giving up.
   * Only applies when forkWith is NOT set (auto-retry mode).
   * When forkWith IS set, retry responsibility belongs to the forkWith handler.
   * @default 0 (no retry)
   */
  readonly maxRetries?: number;

  /** Called when an item exhausts all retries. */
  readonly onMaxRetries?: (item: T, lastError: Cause.Cause<E>) => Effect.Effect<void>;
}
```

### 4.5 New: Lifecycle hooks (ProcessStore integration)

```typescript
{
  /** Fired after item(s) enter a priority queue. */
  readonly onEnqueued?: (items: readonly T[], priority: "high" | "normal" | "low") => Effect.Effect<void>;

  /** Fired after each item's effect completes (success or failure). */
  readonly onEffectComplete?: (item: T, exit: Exit.Exit<R, E>, duration: Duration.Duration) => Effect.Effect<void>;

  /** Fired after forkWith completes for an item. */
  readonly onForkComplete?: (item: T) => Effect.Effect<void>;

  /** Fired when all priority queues become empty (after drain, not during idle). */
  readonly onEmpty?: () => Effect.Effect<void>;
}
```

### 4.6 New: Observability

```typescript
{
  /**
   * When true, key operations are wrapped with Effect.withSpan.
   * Span names: `QueueResource.processItem`, `QueueResource.enqueue`, etc.
   * @default false
   */
  readonly spans?: boolean;
}
```

---

## 5. Internal architecture

### 5.1 Replace homegrown throttler with `RateLimiter`

**Before:** Custom `makeGlobalThrottler` using `Ref<number>` + `Duration` math.

**After:** Use a scoped `RateLimiter` from Effect (if available in the installed version) or a refined internal implementation using `Semaphore` + `Clock`. The key change: throttling is per-start (not per-completion), applied inside the semaphore-gated worker.

Decision: check if `RateLimiter` is exported from `effect` in v4. If yes, use it. If not (or if it requires an external layer), keep a cleaned-up internal version.

### 5.2 Replace manual fiber tracking with `FiberSet`

**Before:** `Ref<Set<Fiber<void>>>` with manual add/remove/joinAll.

**After:** `FiberSet.make()` (scoped) — automatic cleanup, `.add(effect)` returns the fiber, `.join` on scope close.

### 5.3 Worker architecture (behavioral fixes)

**Problem 1: Busy-loop after shutdown.**
Workers currently re-enter `Effect.forever` even when `isRunning` is false.

**Fix:** Worker loop checks `isRunning` and returns `Effect.interrupt` (or breaks out of `Effect.forever` via `Effect.when`) when shutdown is signaled.

**Problem 2: `pause()` not honored during `Queue.take` block.**

**Fix:** Use a `Latch` (or `Deferred`-based gate) that workers `await` before each take. `pause()` closes the latch; `resume()` opens it. Workers blocked in take will process their current item, then block on the latch before the next iteration.

**Problem 3: Priority inversion in `Effect.race` for empty-queue blocking.**
When all queues are empty, the current code races `Queue.take` on all three. `Effect.race` does not guarantee the high-priority queue wins next time.

**Fix:** After blocking wait (any queue wakes), immediately re-enter the priority-ordered poll loop. Only use `Effect.race` for the blocking wait signal, not for item retrieval.

### 5.4 `Effect.fn` for named functions

Key internal functions become `Effect.fn`:

| Function | Span name |
|----------|-----------|
| `processItem` | `QueueResource.processItem` |
| `enqueueItems` | `QueueResource.enqueue` |
| `workerLoop` | `QueueResource.worker` |
| `refillFromSource` | `QueueResource.refill` |

### 5.5 Log annotations

All queue operations annotated with:
- `queue.name` — the string name from config
- `queue.priority` — which priority level (on enqueue/dequeue)
- `queue.worker.id` — worker index (0..concurrency-1)

---

## 6. Type system design

### 6.1 Class factory signatures

```typescript
export const QueueResource: {
  Tag: <Self, T, R, E = never>() =>
    <const Name extends string>(name: Name) =>
      /* abstract class extending Context.Service<Self, QueueRef<Name, T, R, E>> */;

  Service: <Self, T, R, E = never>() =>
    <const Name extends string, RFork = never, RItem = never>(
      name: Name,
      config: QueueResourceConfig<T, R, E, RFork, RItem, Name>,
    ) => /* class with static .layer: Layer<Self, never, RFork | RItem> */;

  layer: <Name extends string, T, R, E, RFork = never, RItem = never>(
    tag: Context.Key<any, QueueRef<Name, T, R, E>>,
    config: QueueResourceConfig<T, R, E, RFork, RItem, Name>,
  ) => Layer.Layer</* tag identifier */, never, RFork | RItem>;
};
```

### 6.2 Conditional `forkWith` enforcement

When `[E] extends [never]`: `forkWith` is optional.
When `E` is non-never: `forkWith` is **required** (compile error if missing).

This works in both `Service()("name", config)` and `layer(tag, config)` because the config is always in a function-call position where TypeScript can narrow conditional types.

### 6.3 Requirement propagation

The layer's requirement type (`R` of the `Layer`) is the union of:
- `RItem` — requirements of `config.effect`
- `RFork` — requirements of `config.forkWith`
- Requirements from `cache`, `refill`, hooks (all inferred)

This ensures the app must provide all needed services when using `Effect.provide(EmailQueue.layer)`.

---

## 7. ProcessGroup compatibility

`ProcessGroup` uses queues as `Context.Key<any, QueueRef<any, any, any, any>>`. Both `Tag` and `Service` produce classes that satisfy this constraint. **No changes to `ProcessGroup.ts` required.**

```typescript
const group = yield* ProcessGroup.make({
  queues: [EmailQueue, AnalyticsQueue], // class references work as Context.Key
  processes: [emailProcess],
});
```

---

## 8. File scope

### Files to rewrite from scratch

| File | Reason |
|------|--------|
| `src/QueueResource.ts` | Full rewrite: new API surface, new internals |
| `test/queue-resource.test.ts` | Tests for new API |

### Files with minimal changes

| File | Change |
|------|--------|
| `src/index.ts` | Update re-exports (remove old type aliases, add new ones) |
| `src/Resource.ts` | Update `Resource.makeQueue` → `QueueResource.layer` delegation |

### Files NOT touched (minimize merge conflicts)

| File | Reason safe |
|------|-------------|
| `src/ProcessGroup.ts` | Uses `Context.Key<any, QueueRef<...>>` — works with both old and new |
| `src/RunResource.ts` | Separate module, same pattern but separate PR |
| `src/HttpApiResource.ts` | Separate module, same pattern but separate PR |
| `src/Process.ts` | Unrelated |
| `src/ProcessStore.ts` | Unrelated (hooks call INTO store, don't change store) |
| `src/ControlService.ts` | Unrelated |
| Examples | Defer to separate commit (or update in this PR if low conflict risk) |

---

## 9. Implementation phases

### Phase 1: Core rewrite (class-based API + existing feature parity)

1. Delete current `src/QueueResource.ts` contents.
2. Implement `QueueResource.Tag` class factory.
3. Implement `QueueResource.layer` (scoped layer builder from config).
4. Implement `QueueResource.Service` (Tag + auto-layer).
5. Implement internal `makeQueueResourceEffect` with:
   - Priority queues (high/normal/low)
   - Semaphore-gated workers
   - Cleaned-up throttler (or `RateLimiter`)
   - `FiberSet` for fork tracking
   - Fixed shutdown (no busy-loop)
   - Fixed pause (`Latch`-based)
   - Fixed priority inversion in empty-queue blocking
6. Retain `QueueRef` interface shape (with `deferred` spelling fix).
7. Retain `QueueResourceConfig` conditional `forkWith` logic.
8. Delete old type aliases (`QueueResourceInstance`, `QueueResourceInterface`).

### Phase 2: New features

1. `getKey` + `skipDuplicates` (deduplication via internal `HashSet` of active keys).
2. `maxRetries` + `onMaxRetries` (retry counter tracked per-item via wrapper).
3. Lifecycle hooks (`onEnqueued`, `onEffectComplete`, `onForkComplete`, `onEmpty`).
4. `Effect.fn` named functions for key internals.
5. Optional spans (`spans: true` in config).
6. Log annotations (`queue.name`, `queue.priority`, `queue.worker.id`).

### Phase 3: Tests

1. Rewrite `test/queue-resource.test.ts` for new API.
2. Cover: basic processing, batch, priority ordering, forkWith (required + optional), pause/resume, shutdown, restart, dedup, retries, hooks, layer-swap patterns.
3. Verify ProcessGroup integration (existing ProcessGroup tests should still pass with updated queue declarations).

### Phase 4: Exports and umbrella

1. Update `src/index.ts` exports.
2. Update `src/Resource.ts` umbrella.
3. Update examples (if in scope for this branch).

---

## 10. Removed / replaced

| Old | Disposition |
|-----|-------------|
| `QueueResource.make` | **Removed.** Use `QueueResource.Service` or `QueueResource.Tag` + `QueueResource.layer`. |
| `QueueResourceInstance<T, R, E>` | **Removed.** Use `QueueRef<Name, T, R, E>` directly. |
| `QueueResourceInterface<T, R, E>` | **Removed.** Use `QueueRef<Name, T, R, E>` directly. |
| `QueueResourceConfigBase` | **Removed.** Merged into single `QueueResourceConfig`. |
| `deffered` method | **Removed.** Replaced by correctly-spelled `deferred`. |
| `_workers` field on `QueueRef` | **Removed.** Internal fiber management uses `FiberSet`; no public exposure. |
| `Cause` re-export | **Removed.** Users import `Cause` from `effect` directly. |
| `QueueItemEffectRequirements` utility type | **Evaluate.** Keep if useful for advanced typing; remove if redundant with inferred layer requirements. |

---

## 11. Migration guide (0.7-beta → 0.8-beta)

### Before (old API):

```typescript
import { QueueResource } from "@nikscripts/effect-pm";

const EmailQueue = QueueResource.make({
  name: "email-queue",
  effect: (email: Email) => sendEmail(email),
  concurrency: 5,
  throttle: { limit: 100, duration: Duration.minutes(1) },
});

// Usage:
const queue = yield* EmailQueue;
yield* queue.add(emails);
yield* queue.deffered(lowPriority);
Effect.provide(EmailQueue.layer);
```

### After (new API):

```typescript
import { QueueResource } from "@nikscripts/effect-pm";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, void, never>()("email-queue", {
  effect: (email: Email) => sendEmail(email),
  concurrency: 5,
  throttle: { limit: 100, duration: Duration.minutes(1) },
}) {}

// Usage (identical except spelling fix):
const queue = yield* EmailQueue;
yield* queue.add(emails);
yield* queue.deferred(lowPriority);  // spelling fix: deffered → deferred
Effect.provide(EmailQueue.layer);
```

### Migration steps:

1. Replace `const X = QueueResource.make({ name: "foo", ... })` with `class X extends QueueResource.Service<X, T, R, E>()("foo", { ... }) {}`.
2. Move type parameters from inference to explicit class generics: `<Self, T, R, E>`.
3. Rename `queue.deffered(...)` → `queue.deferred(...)`.
4. Remove imports of `QueueResourceInterface` / `QueueResourceInstance` — use `QueueRef<Name, T, R, E>`.
5. If you imported `Cause` from `@nikscripts/effect-pm`, import from `effect` instead.
6. `onSuccess` / `onError` callbacks (if used from older versions) are now `forkWith`.

---

## 12. Open questions

1. **`RateLimiter` availability** — is it exported from `effect` v4 beta, or is it under `unstable/`? If unavailable, keep refined internal throttler.
2. **Dedup key storage** — in-memory `HashSet` per queue, or pluggable? Start in-memory; make pluggable later if needed.
3. **Hook error handling** — if a hook (`onEnqueued`, etc.) fails, should it log and continue or propagate? Recommendation: log + continue (hooks are observability, not control flow).
4. **`Resource.makeQueue` umbrella** — should it delegate to `QueueResource.layer` (pure layer) or remain a convenience that mirrors `QueueResource.Service`? Recommendation: delegate to `QueueResource.layer`.
5. **Should `spans` default to `true`?** Recommendation: default `false` for now (opt-in); flip to `true` in a future release when tracing is standard.

---

## 13. References

- [Plan 07 — QueueResource & storage hooks](./07-queue-resource.md)
- [EFFECT-V4-FEATURE-SCOUT.md](../EFFECT-V4-FEATURE-SCOUT.md) — `RateLimiter`, `FiberSet`, metrics/spans
- [queue-resource-testing-notes.md](../queue-resource-testing-notes.md) — behavioral issues
- [PLAN_RESOURCE_AND_HTTP_CLIENT.md](../PLAN_RESOURCE_AND_HTTP_CLIENT.md) — naming and factory patterns
- [Plan 09 — Process v2](./09-process-v2-effect-first.md) — "do not change QueueResource" guardrail (overridden by this plan)
