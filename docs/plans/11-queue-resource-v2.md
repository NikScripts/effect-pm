# 11 — QueueResource v2: Effect-idiomatic rewrite

**Status:** Plan (implementation target for next beta)

**Breaking:** Yes. Full rewrite. Migration guide at bottom.

---

## 1. Design philosophy

This is not a refactor. It is a ground-up redesign following Effect's conventions:

- **The library provides `make` functions that return Effects.** Users wire them into standard `Context.Service` classes themselves.
- **No custom class factories.** No `QueueResource.Tag`, no `QueueResource.Service`. Users use `Context.Service` directly.
- **No auto-generated `.layer`.** Users build layers with `Layer.scoped` (standard).
- **Named functions via `Effect.fn`.** Every meaningful operation has a span name.
- **`FiberSet` for fork tracking.** No manual `Ref<Set<Fiber>>`.
- **`Latch` for pause/resume.** No polling `isPaused` flag.
- **`Data.TaggedError` for all errors.**
- **Dual-style APIs where appropriate.**

---

## 2. What the library exports

```typescript
import { QueueResource } from "@nikscripts/effect-pm"
```

### 2.1 `QueueResource.make`

The core factory. Returns a **scoped Effect** that produces a `QueueResource.Queue`.

```typescript
QueueResource.make(config: QueueResource.Config<T, R, E, ...>): Effect<QueueResource.Queue<T, R, E>, never, Scope>
```

### 2.2 `QueueResource.layer`

Convenience: builds a `Layer` from a tag + config. Equivalent to `Layer.scoped(tag, QueueResource.make(config))`.

```typescript
QueueResource.layer(tag, config): Layer.Layer<TagIdentifier, never, Requirements>
```

### 2.3 `QueueResource.Queue<T, R, E>` (the service shape)

The interface you get from `yield* MyQueue`.

### 2.4 `QueueResource.Config<T, R, E, ...>` (the config type)

Full configuration with all features.

---

## 3. User-facing patterns

### 3.1 Declare a queue service (standard `Context.Service`)

```typescript
import { Context, Layer } from "effect"
import { QueueResource } from "@nikscripts/effect-pm"

class EmailQueue extends Context.Service<EmailQueue, QueueResource.Queue<Email, void, SmtpError>>()(
  "@app/EmailQueue"
) {}
```

### 3.2 Build the layer

```typescript
const EmailQueueLive = Layer.scoped(
  EmailQueue,
  QueueResource.make({
    effect: (email: Email) => sendEmail(email),
    handler: (item, exit) =>
      exit.pipe(
        Exit.match({
          onFailure: (cause) => deadLetter.add(item),
          onSuccess: () => Effect.void,
        }),
      ),
    concurrency: 5,
    throttle: { limit: 100, duration: Duration.minutes(1) },
  }),
)
```

Or using the convenience helper:

```typescript
const EmailQueueLive = QueueResource.layer(EmailQueue, {
  effect: (email: Email) => sendEmail(email),
  handler: (item, exit) => ...,
  concurrency: 5,
})
```

### 3.3 Use the queue

```typescript
const program = Effect.gen(function*() {
  const queue = yield* EmailQueue
  yield* queue.add(pendingEmails)
})

program.pipe(Effect.provide(EmailQueueLive))
```

### 3.4 Inline with `{ make }` (ProcessStore-style, most concise)

```typescript
class EmailQueue extends Context.Service<EmailQueue>()(
  "@app/EmailQueue",
  {
    make: QueueResource.make({
      effect: (email: Email) => sendEmail(email),
      handler: (item, exit) => ...,
      concurrency: 5,
    }),
  },
) {}

// Layer:
const EmailQueueLive = Layer.scoped(EmailQueue, EmailQueue.make)
```

### 3.5 ProcessGroup integration

```typescript
const group = yield* ProcessGroup.make({
  queues: [EmailQueue, AnalyticsQueue],
  processes: [syncProcess],
})
```

Works because `Context.Service` classes are `Context.Key` instances.

---

## 4. `QueueResource.Queue<T, R, E>` — the service shape

```typescript
export declare namespace QueueResource {
  interface Queue<in out T, out R = void, out E = never> {
    // ─── Enqueue ───
    readonly add: (item: T | ReadonlyArray<T>) => Effect<void>
    readonly prioritize: (item: T | ReadonlyArray<T>) => Effect<void>
    readonly defer: (item: T | ReadonlyArray<T>) => Effect<void>

    // ─── Observe ───
    readonly size: Effect<number>
    readonly sizes: Effect<{ readonly high: number; readonly normal: number; readonly low: number }>
    readonly isEmpty: Effect<boolean>
    readonly completed: Effect<number>

    // ─── Lifecycle ───
    readonly pause: Effect<void>
    readonly resume: Effect<void>
    readonly shutdown: Effect<void>
    readonly clear: Effect<number>
  }
}
```

**Naming decisions:**
- `add` — normal priority (the default operation)
- `prioritize` — high priority (verb: "prioritize this item")
- `defer` — low priority (verb: "defer this item")
- `size` / `sizes` / `isEmpty` / `completed` — effectful **properties** (no `()` call needed). These are `Effect<T>` not `() => Effect<T>`.
- `pause` / `resume` / `shutdown` / `clear` — effectful properties (actions with no input)
- `clear` replaces `restart` — clearer semantics: empties queues, resets counter, returns items cleared. Does NOT stop workers.

**Why effectful properties instead of methods:**

Effect convention for service interfaces uses properties when there's no input:
```typescript
readonly size: Effect<number>          // yield* queue.size
readonly add: (item: T) => Effect<void> // yield* queue.add(item)
```

---

## 5. `QueueResource.Config<T, R, E>` — full configuration

```typescript
export declare namespace QueueResource {
  interface Config<T, R, E, RHandler = never, RItem = never> {
    // ─── Core ───

    /** Process each item. */
    readonly effect: (item: T) => Effect<R, E, RItem>

    /** Handle each item's result. Runs in a managed fiber. Must eliminate E. */
    readonly handler?: (item: T, exit: Exit<R, E>) => Effect<void, never, RHandler>

    // ─── Concurrency ───

    /** Max items processing concurrently. @default 5 */
    readonly concurrency?: number

    /** Max items per priority queue. @default 50_000 */
    readonly capacity?: number

    /** Rate limit: max starts per window. */
    readonly throttle?: { readonly limit: number; readonly duration: Duration.Input }

    // ─── Deduplication ───

    /** Extract a dedup key. When set, items with a key already in-flight are dropped. */
    readonly key?: (item: T) => string

    // ─── Retry ───

    /** Auto-retry failed items (only when handler is NOT set). @default 0 */
    readonly retries?: number

    /** Called when retries exhausted. */
    readonly onRetryExhausted?: (item: T, cause: Cause<E>) => Effect<void>

    // ─── Persistence ───

    /** Persist items on enqueue (before processing). */
    readonly persist?: (items: ReadonlyArray<T>, priority: Priority) => Effect<void>

    /** Refill from external source when empty. */
    readonly refill?: (queue: Queue<T, R, E>) => Effect<void>

    // ─── Hooks (fire-and-forget, errors logged) ───

    readonly onEnqueue?: (items: ReadonlyArray<T>, priority: Priority) => Effect<void>
    readonly onComplete?: (item: T, exit: Exit<R, E>, elapsed: Duration.Duration) => Effect<void>
    readonly onEmpty?: Effect<void>
  }

  type Priority = "high" | "normal" | "low"
}
```

**Key design decisions:**

1. **`handler` replaces `forkWith`** — clearer name, receives `Exit<R, E>` directly (the Effect-native result type), runs in a managed fiber.

2. **`handler` is always optional** — when `E ≠ never` and no `handler` is set:
   - If `retries > 0`: auto-retry, then call `onRetryExhausted`.
   - If `retries === 0` and no handler: the failure is **logged** and the item is dropped.
   - This eliminates the confusing conditional-required pattern.

3. **`key` replaces `getKey`/`skipDuplicates`** — simpler. If `key` is set, dedup is active. No boolean flag needed.

4. **`persist` replaces `cache`** — clearer name. "Cache" implies read; "persist" implies write-through.

5. **`throttle.duration` accepts `Duration.Input`** — Effect convention: accept both `Duration` and string literals (`"1 minute"`, `"500 millis"`).

6. **Hooks are fire-and-forget** — errors are logged but never propagate. Hooks are observability, not control flow.

---

## 6. Internal architecture

### 6.1 Worker loop (using `Latch` + `FiberSet`)

```typescript
const workerLoop = Effect.fn("QueueResource.worker")(function*(workerId: number) {
  yield* Effect.annotateLogs({ "queue.worker": workerId })

  while (true) {
    yield* latch.await          // blocks when paused
    const item = yield* takeNext() // priority-ordered poll then block
    yield* processItem(item)
  }
})
```

**Pause/resume:** `latch.close` pauses (workers block on next iteration). `latch.open` resumes (all waiting workers wake).

**Shutdown:** Interrupt the scoped FiberSet (automatic on scope close). Workers exit cleanly.

### 6.2 Priority dispatch

```typescript
const takeNext = Effect.fn("QueueResource.take")(function*() {
  // Poll in priority order (non-blocking)
  const high = yield* InternalQueue.poll(highQueue)
  if (Option.isSome(high)) return high.value

  const normal = yield* InternalQueue.poll(normalQueue)
  if (Option.isSome(normal)) return normal.value

  const low = yield* InternalQueue.poll(lowQueue)
  if (Option.isSome(low)) return low.value

  // All empty → race for wake signal, then re-poll
  yield* Deferred.await(wakeSignal)
  return yield* takeNext()
})
```

When items are enqueued, `wakeSignal` is completed (and recreated). This avoids the priority-inversion problem of `Effect.race(Queue.take, Queue.take, Queue.take)`.

### 6.3 Item processing

```typescript
const processItem = Effect.fn("QueueResource.processItem")(function*(item: T) {
  yield* semaphore.withPermits(1)(
    throttle(
      Effect.gen(function*() {
        const start = yield* Effect.clockWith((c) => c.currentTimeMillis)
        const exit = yield* Effect.exit(config.effect(item))
        const elapsed = /* compute from start */

        yield* Ref.update(completedCount, (n) => n + 1)

        // Hook
        if (config.onComplete) {
          yield* Effect.forkIn(fiberSet)(
            config.onComplete(item, exit, elapsed).pipe(Effect.ignore)
          )
        }

        // Handler or auto-retry
        if (config.handler) {
          yield* FiberSet.run(handlerFibers, config.handler(item, exit).pipe(Effect.ignore))
        } else if (Exit.isFailure(exit) && retries > 0) {
          yield* retryItem(item, exit.cause, 1)
        }

        // Dedup key release
        if (config.key) {
          yield* Ref.update(activeKeys, HashSet.remove(config.key(item)))
        }
      })
    )
  )
})
```

### 6.4 Deduplication

On enqueue:
```typescript
if (config.key) {
  const k = config.key(item)
  const keys = yield* Ref.get(activeKeys)
  if (HashSet.has(keys, k)) return // silently drop
  yield* Ref.update(activeKeys, HashSet.add(k))
}
```

Key is released after processing completes (success or failure, after handler).

### 6.5 Throttling

Internal throttle using `Semaphore` and `Clock`:
```typescript
const makeThrottle = (limit: number, window: Duration.Duration) =>
  Effect.gen(function*() {
    const sem = yield* Semaphore.make(limit)
    return <A, E, R>(effect: Effect<A, E, R>) =>
      sem.withPermits(1)(
        Effect.zipRight(
          effect,
          Effect.sleep(window) // hold permit for window duration
        )
      )
  })
```

This is a token-bucket style: each permit represents one execution slot within the window. Simpler and more correct than timestamp tracking.

### 6.6 Scope lifecycle

```typescript
QueueResource.make = (config) => Effect.gen(function*() {
  // Allocate queues, latch, semaphore, fiber sets
  const highQueue = yield* InternalQueue.bounded<T>(capacity)
  const normalQueue = yield* InternalQueue.bounded<T>(capacity)
  const lowQueue = yield* InternalQueue.bounded<T>(capacity)
  const latch = yield* Latch.make(true) // starts open (running)
  const semaphore = yield* Semaphore.make(concurrency)
  const workerFibers = yield* FiberSet.make<void>()
  const handlerFibers = yield* FiberSet.make<void>()

  // Start workers
  for (let i = 0; i < concurrency; i++) {
    yield* FiberSet.run(workerFibers, workerLoop(i))
  }

  // Return the Queue handle
  return { add, prioritize, defer, size, sizes, isEmpty, completed, pause, resume, shutdown, clear }
})
```

When the scope closes:
1. `workerFibers` is interrupted (all workers stop)
2. `handlerFibers` is interrupted (in-flight handlers stop)
3. Internal queues are shut down

No manual finalizers needed — `FiberSet.make()` is scoped and handles cleanup.

---

## 7. Error types

```typescript
export class QueueShutdownError extends Data.TaggedError("QueueShutdownError")<{
  readonly queue: string
}> {}
```

Enqueue operations after shutdown fail with `QueueShutdownError`. All other errors are typed through the user's `E` on their effect.

---

## 8. Full example (end-to-end)

```typescript
import { Context, Data, Duration, Effect, Exit, Layer } from "effect"
import { QueueResource, ProcessGroup, Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm"

// ─── Define the queue service ───

class EmailQueue extends Context.Service<EmailQueue, QueueResource.Queue<Email, EmailResult, SmtpError>>()(
  "@app/EmailQueue"
) {}

// ─── Build the layer ───

const EmailQueueLive = QueueResource.layer(EmailQueue, {
  effect: (email: Email) => smtpClient.send(email),

  handler: (item, exit) =>
    Exit.match(exit, {
      onFailure: (cause) => Effect.logError("Email failed", { item, cause }),
      onSuccess: (result) => Effect.logInfo("Email sent", { messageId: result.id }),
    }),

  concurrency: 10,
  throttle: { limit: 200, duration: "1 minute" },
  key: (email) => email.messageId,

  persist: (items) => db.emailOutbox.insertMany(items),
  refill: (queue) => Effect.gen(function*() {
    const pending = yield* db.emailOutbox.findPending()
    yield* queue.add(pending)
  }),

  onEmpty: Effect.logDebug("Email queue drained"),
})

// ─── Define a process that feeds the queue ───

const emailSync = Process.make({
  name: "email-sync",
  polling: Polling.spaced(Duration.minutes(1)),
  schedule: ProcessSchedule.alwaysArmed,
  effect: Effect.gen(function*() {
    const queue = yield* EmailQueue
    const pending = yield* fetchNewEmails()
    yield* queue.add(pending)
  }),
})

// ─── Wire it all together ───

const program = Effect.gen(function*() {
  const group = yield* ProcessGroup.make({
    queues: [EmailQueue],
    processes: [emailSync],
  })
  yield* group.startAll()
  yield* group.serve({ port: 3001 })
  yield* ProcessGroup.awaitShutdown(group)
})

program.pipe(
  Effect.provide(Layer.mergeAll(
    EmailQueueLive,
    ProcessStore.layer,
  )),
  Effect.runPromise,
)
```

---

## 9. Test patterns

### 9.1 Fast test config (no throttle, instant processing)

```typescript
const TestEmailQueueLive = QueueResource.layer(EmailQueue, {
  effect: (email: Email) => Effect.succeed({ id: `test-${email.to}` }),
  concurrency: 1,
})
```

### 9.2 Full mock (no processing at all)

```typescript
const calls: Email[] = []
const MockEmailQueueLive = Layer.succeed(EmailQueue, {
  add: (items) => Effect.sync(() => { calls.push(...(Array.isArray(items) ? items : [items])) }),
  prioritize: (items) => Effect.sync(() => { calls.push(...(Array.isArray(items) ? items : [items])) }),
  defer: () => Effect.void,
  size: Effect.succeed(0),
  sizes: Effect.succeed({ high: 0, normal: 0, low: 0 }),
  isEmpty: Effect.succeed(true),
  completed: Effect.succeed(0),
  pause: Effect.void,
  resume: Effect.void,
  shutdown: Effect.void,
  clear: Effect.succeed(0),
})
```

### 9.3 Override default layer (for Service with `{ make }`)

```typescript
// If EmailQueue was declared with { make: QueueResource.make(...) }:
const TestLayer = Layer.scoped(EmailQueue, QueueResource.make({ effect: mockEffect, concurrency: 1 }))
```

---

## 10. File scope

### Rewrite from scratch

| File | Contents |
|------|----------|
| `src/QueueResource.ts` | `QueueResource.make`, `QueueResource.layer`, types, internals |
| `test/queue-resource.test.ts` | Full test suite |

### Minimal changes

| File | Change |
|------|--------|
| `src/index.ts` | Update exports |
| `src/Resource.ts` | `Resource.makeQueue` → delegates to `QueueResource.layer` |

### Not touched

All other source files (`ProcessGroup`, `RunResource`, `HttpApiResource`, `Process`, etc.)

---

## 11. Migration guide

### Before:

```typescript
const EmailQueue = QueueResource.make({
  name: "email-queue",
  effect: (email: Email) => sendEmail(email),
  forkWith: (forked, item, queue) => forked.pipe(Effect.catchAll(() => queue.deffered(item))),
  concurrency: 5,
});

const queue = yield* EmailQueue;
yield* queue.deffered(items);
Effect.provide(EmailQueue.layer);
```

### After:

```typescript
class EmailQueue extends Context.Service<EmailQueue, QueueResource.Queue<Email, void, SmtpError>>()(
  "@app/EmailQueue"
) {}

const EmailQueueLive = QueueResource.layer(EmailQueue, {
  effect: (email: Email) => sendEmail(email),
  handler: (item, exit) => exit.pipe(
    Exit.match({
      onFailure: () => Effect.void,
      onSuccess: () => Effect.void,
    }),
  ),
  concurrency: 5,
});

const queue = yield* EmailQueue;
yield* queue.defer(items);
Effect.provide(EmailQueueLive);
```

### Step-by-step:

1. Declare your queue as `class X extends Context.Service<X, QueueResource.Queue<T, R, E>>()("key") {}`.
2. Build layer with `QueueResource.layer(X, config)` or `Layer.scoped(X, QueueResource.make(config))`.
3. `forkWith(forked, item, queue)` → `handler(item, exit)`. The `exit` is `Exit<R, E>` — use `Exit.match` to handle both cases.
4. `deffered` → `defer`.
5. `next` → `prioritize`.
6. `getCompleted()` → `completed` (effectful property, no parens).
7. `size()` → `size` (effectful property).
8. `sizeByPriority()` → `sizes` (effectful property).
9. `restart()` → `clear` (clears queues + resets counter; workers stay alive).
10. Remove imports of `QueueResourceInterface`, `QueueResourceInstance`, `Cause` re-export.

---

## 12. What the library does NOT do

- **No custom class factories.** Standard `Context.Service` only.
- **No conditional required/optional `handler`.** Handler is always optional. Unhandled failures are logged.
- **No `_workers` leak.** Fiber management is fully internal.
- **No `onSuccess`/`onError` split.** One `handler` receives the full `Exit`. Use `Exit.match`.
- **No busy-loop.** Workers block on `Latch.await` (paused) or `Deferred.await` (empty queue).
- **No legacy type aliases.** One type: `QueueResource.Queue<T, R, E>`.

---

## 13. Open questions

1. **Should `handler` receive the `Queue` handle?** (for re-enqueue on failure). Leaning yes: `handler: (item, exit, queue) => ...`
2. **Should `clear` return the cleared items or just the count?** Count is cheaper; items would require draining into an array.
3. **Should `throttle` use a token-bucket (hold-permit) or sliding-window approach?** Token-bucket is simpler and more predictable.
4. **Should `refill` run automatically when empty, or only on explicit trigger?** Currently: auto on empty. Alternative: expose `refill` as a method on the queue handle.

---

## 14. References

- Effect v4 `Context.Service` — `node_modules/effect/src/Context.ts`
- Effect `FiberSet` — `node_modules/effect/src/FiberSet.ts`
- Effect `Latch` — `node_modules/effect/src/Latch.ts`
- Effect `Effect.fn` — `node_modules/effect/src/Effect.ts`
- Effect `Data.TaggedError` — standard error pattern
