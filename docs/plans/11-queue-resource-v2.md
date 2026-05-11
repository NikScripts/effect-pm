# 11 — QueueResource v2: class-based factories + Effect-idiomatic internals

**Status:** Plan (implementation target for next beta)

**Breaking:** Yes. Full rewrite. Migration guide at bottom.

---

## 1. Design philosophy

Custom class factories (`QueueResource.Service`, `QueueResource.Tag`) for ergonomic DX. Everything else follows Effect conventions:

- **`Effect.fn` for named functions** with automatic span names.
- **`FiberSet` for fork tracking.** No manual `Ref<Set<Fiber>>`.
- **`Latch` for pause/resume.** No polling `isPaused` flag.
- **`Data.TaggedError` for all errors.**
- **Effectful properties** where no input is needed (`size`, `completed`).
- **`Exit` as the result type** in handlers (standard Effect result modeling).
- **`Duration.Input` accepted** where durations are configured (strings like `"1 minute"`).
- **`Effect.annotateLogs`** for structured log context.

---

## 2. Public API

### 2.1 `QueueResource.Service` — identity + default layer (primary)

Config baked into class. Auto-generates `.layer`. The 90% case.

```typescript
class EmailQueue extends QueueResource.Service<EmailQueue, Email, void, SmtpError>()("@app/EmailQueue", {
  effect: (email) => sendEmail(email),
  handler: (item, exit, ctx) =>
    Exit.match(exit, {
      onFailure: () => ctx.retry,  // re-enqueue (back of line)
      onSuccess: () => Effect.void,
    }),
  retries: 3,
  onRetryExhausted: (item) => deadLetter.add(item),
  concurrency: 5,
  limit: RateLimiter.make(100, "1 minute"),
}) {}

// EmailQueue IS the Context.Tag
// EmailQueue.layer is auto-generated (Layer.scoped)

const queue = yield* EmailQueue
yield* queue.add(emails)
Effect.provide(EmailQueue.layer)
```

### 2.2 `QueueResource.Tag` — pure identity, no default layer

For shared contracts, library interfaces, dependency inversion.

```typescript
class JobQueue extends QueueResource.Tag<JobQueue, Job, JobResult, JobError>()("@app/JobQueue") {}

// No .layer — consumers provide one:
const JobQueueLive = QueueResource.layer(JobQueue, { effect: ..., handler: ... })
```

### 2.3 `QueueResource.layer` — build a layer for any tag

Works with both `Service` and `Tag`. For tests, environment overrides, alternate implementations.

```typescript
// Override a Service's default:
const TestEmailLayer = QueueResource.layer(EmailQueue, { effect: mockSend, concurrency: 1 })

// Provide for a Tag:
const JobQueueProd = QueueResource.layer(JobQueue, { effect: processJob, concurrency: 20, handler: ... })
```

### 2.4 `QueueResource.make` — raw scoped Effect (escape hatch)

For users who want full manual control or to use `Context.Service` directly.

```typescript
// Use with standard Context.Service:
class MyQueue extends Context.Service<MyQueue>()(
  "@app/MyQueue",
  { make: QueueResource.make({ effect: ..., concurrency: 5 }) }
) {}

const layer = Layer.scoped(MyQueue, MyQueue.make)
```

### 2.5 Guidance

| Scenario | Use |
|----------|-----|
| Concrete queue, config known at declaration | `QueueResource.Service` |
| Abstract queue, implementation varies | `QueueResource.Tag` + `QueueResource.layer` |
| Tests / env-specific override | `QueueResource.layer(Tag, altConfig)` |
| Full mock (no processing) | `Layer.succeed(Tag, mockHandle)` |
| Want standard `Context.Service` directly | `QueueResource.make` + `Layer.scoped` |

---

## 3. `QueueResource.Queue<T, R, E>` — the service shape

```typescript
export declare namespace QueueResource {
  interface Queue<in out T, out R = void, out E = never> {
    // ─── Enqueue ───
    readonly add: (item: T | ReadonlyArray<T>) => Effect<void>
    readonly prioritize: (item: T | ReadonlyArray<T>) => Effect<void>
    readonly defer: (item: T | ReadonlyArray<T>) => Effect<void>

    // ─── Observe (effectful properties — no parens) ───
    readonly size: Effect<number>
    readonly sizes: Effect<{ readonly high: number; readonly normal: number; readonly low: number }>
    readonly isEmpty: Effect<boolean>
    readonly completed: Effect<number>

    // ─── Lifecycle (effectful properties — no parens) ───
    readonly pause: Effect<void>
    readonly resume: Effect<void>
    readonly shutdown: Effect<void>
    readonly clear: Effect<number>
  }
}
```

**Naming:**
- `add` — normal priority (default operation)
- `prioritize` — high priority (verb: "prioritize this")
- `defer` — low priority (verb: "defer this")
- `size` / `sizes` / `isEmpty` / `completed` — effectful properties, use as `yield* queue.size`
- `pause` / `resume` / `shutdown` / `clear` — effectful properties, use as `yield* queue.pause`
- `clear` replaces `restart` — empties all queues, resets counter, returns items cleared. Workers stay alive.

---

## 4. `QueueResource.Config<T, R, E>` — full configuration

```typescript
export declare namespace QueueResource {
  interface Config<T, R, E, RHandler = never, RItem = never> {
    // ─── Core ───

    /**
     * Process each item. Receives a context with guarded enqueue operations
     * for spawning derived work. Self-enqueue attempts are warned and dropped
     * (prevents infinite loops). Use `ctx.retry` in the handler for intentional re-processing.
     */
    readonly effect: (item: T, ctx: EffectContext<T, R, E>) => Effect<R, E, RItem>

    /**
     * Handle each item's result. **Always forked** — runs in its own fiber,
     * never blocks the worker from picking up the next item.
     *
     * Receives:
     * - `item` — the processed item
     * - `exit` — Exit<R, E> (success value or failure cause)
     * - `ctx` — HandlerContext: `retry`, `add`, `prioritize`, `defer`
     *
     * **`ctx.retry`** re-enqueues the item at the same priority level.
     * This is a RE-ENQUEUE, not an immediate retry — the item goes to the
     * back of its priority queue and waits its turn like any other item.
     * Respects `retries` limit; when exhausted → `onRetryExhausted`.
     *
     * There is NO automatic retry on failure. The handler decides whether
     * to retry, log, dead-letter, or drop. This keeps retry policy in
     * userland where it belongs.
     *
     * Must return Effect<void, never, RHandler> (errors eliminated).
     * Optional — when absent, failures are logged and items dropped.
     *
     * Managed by a FiberSet: in-flight handlers are awaited on scope close.
     */
    readonly handler?: (item: T, exit: Exit<R, E>, ctx: HandlerContext<T, R, E>) => Effect<void, never, RHandler>

    // ─── Concurrency ───

    /** Max items processing concurrently. @default 5 */
    readonly concurrency?: number

    /** Max items per priority queue. @default 50_000 */
    readonly capacity?: number

    /**
     * Rate limiter. Pass the result of RateLimiter.make(limit, window).
     * The queue calls .consume() before each item with onExceeded: "delay".
     * Requirements propagate to the layer.
     *
     * @example limit: RateLimiter.make(10, "2 seconds")
     */
    readonly limit?: Effect<RateLimiter, never, any>

    // ─── Deduplication ───

    /** Extract a dedup key. Items with a key already in-flight are silently dropped. */
    readonly key?: (item: T) => string

    // ─── Retry ───

    /**
     * Max times an item may be re-enqueued via ctx.retry (in the handler).
     * When exhausted → `onRetryExhausted` is called.
     * There is NO automatic retry — the handler must explicitly call ctx.retry.
     * @default Infinity (unlimited retries unless capped here)
     */
    readonly retries?: number

    /** Called when ctx.retry is invoked but the retry limit is reached. */
    readonly onRetryExhausted?: (item: T, cause: Cause<E>) => Effect<void>

    // ─── Persistence ───

    /** Persist items on enqueue (before processing). */
    readonly persist?: (items: ReadonlyArray<T>, priority: Priority) => Effect<void>

    /** Refill from external source when all queues are empty. */
    readonly refill?: (queue: Queue<T, R, E>) => Effect<void>

    // ─── Hooks (fire-and-forget, errors logged and swallowed) ───

    readonly onEnqueue?: (items: ReadonlyArray<T>, priority: Priority) => Effect<void>
    readonly onComplete?: (item: T, exit: Exit<R, E>, elapsed: Duration.Duration) => Effect<void>
    readonly onEmpty?: Effect<void>
  }

  type Priority = "high" | "normal" | "low"

  /** Passed to effect — guarded enqueue for derived work + item metadata. */
  interface EffectContext<T, R, E> {
    /** Enqueue derived items (normal priority). Warns+drops if same item detected. */
    readonly add: (items: T | ReadonlyArray<T>) => Effect<void>
    /** Enqueue derived items (high priority). Warns+drops if same item detected. */
    readonly prioritize: (items: T | ReadonlyArray<T>) => Effect<void>
    /** Enqueue derived items (low priority). Warns+drops if same item detected. */
    readonly defer: (items: T | ReadonlyArray<T>) => Effect<void>

    // ─── Item metadata ───
    /** How many times this item has been processed (1 = first attempt). */
    readonly attempts: number
    /** When the item first entered the queue (survives retries). */
    readonly enqueuedAt: Date
    /** The priority level this item was enqueued at. */
    readonly priority: Priority
  }

  /**
   * Passed to handler — full control including retry.
   *
   * `retry` re-enqueues the item at the SAME priority it originally entered.
   * The item goes to the BACK of that priority queue — it is not processed
   * immediately. It waits its turn behind any other items at that level.
   * This is intentional: it gives the system time to recover (rate limits,
   * transient failures) before the item is attempted again.
   */
  interface HandlerContext<T, R, E> {
    /**
     * Re-enqueue this item (back of same priority queue).
     * Tracked: respects `retries` limit. When exhausted → onRetryExhausted.
     * This is NOT immediate re-execution — the item waits in line.
     */
    readonly retry: Effect<void>

    /** Enqueue new/derived items at normal priority. */
    readonly add: (items: T | ReadonlyArray<T>) => Effect<void>
    /** Enqueue new/derived items at high priority. */
    readonly prioritize: (items: T | ReadonlyArray<T>) => Effect<void>
    /** Enqueue new/derived items at low priority. */
    readonly defer: (items: T | ReadonlyArray<T>) => Effect<void>

    // ─── Item metadata ───
    /** How many times this item has been processed (1 = first attempt). */
    readonly attempts: number
    /** When the item first entered the queue (survives retries). */
    readonly enqueuedAt: Date
    /** The priority level this item was enqueued at. */
    readonly priority: Priority
  }
}
```

**Key decisions:**

1. **`handler` replaces `forkWith`** — receives `Exit<R, E>` directly (Effect-native). Clearer name. **Always forked into its own fiber** — the worker immediately moves to the next item without waiting for the handler to complete. In-flight handler fibers are tracked by a `FiberSet` and awaited on scope close (graceful shutdown). Always optional — unhandled failures are logged.

2. **No automatic retry.** The handler decides retry policy. `ctx.retry` re-enqueues (back of queue, NOT immediate). `retries` config is just a cap. When absent, failures are logged and items dropped.

3. **`key` for dedup** — if set, dedup is active. No separate boolean.

4. **`persist` replaces `cache`** — "persist" is write-through semantics.

5. **`limit` accepts `RateLimiter.make(n, window)`** — e.g. `limit: RateLimiter.make(10, "2 seconds")`. Uses Effect's `RateLimiter`.

6. **Hooks are fire-and-forget** — errors logged, never propagate.

7. **`handler` receives queue handle?** — Yes: `(item, exit, queue) => ...` for re-enqueue patterns.

Updated signatures:
```typescript
readonly effect: (item: T, ctx: EffectContext<T, R, E>) => Effect<R, E, RItem>
readonly handler?: (item: T, exit: Exit<R, E>, ctx: HandlerContext<T, R, E>) => Effect<void, never, RHandler>
```

---

## 5. Internal architecture

### 5.1 Worker loop (`Latch` + `FiberSet`)

```typescript
const workerLoop = Effect.fn("QueueResource.worker")(function*(workerId: number) {
  yield* Effect.annotateLogs({ "queue.worker": workerId })

  while (true) {
    yield* latch.await          // blocks when paused
    const item = yield* takeNext()
    yield* processItem(item)
  }
})
```

`Latch` starts open. `pause` closes it. `resume` opens it. Workers block at the top of each iteration.

### 5.2 Priority dispatch (no priority inversion)

```typescript
const takeNext = Effect.fn("QueueResource.take")(function*() {
  // Priority-ordered non-blocking poll
  const high = yield* InternalQueue.poll(highQueue)
  if (Option.isSome(high)) return high.value

  const normal = yield* InternalQueue.poll(normalQueue)
  if (Option.isSome(normal)) return normal.value

  const low = yield* InternalQueue.poll(lowQueue)
  if (Option.isSome(low)) return low.value

  // All empty → wait for wake signal, then re-poll
  yield* Deferred.await(wakeSignal)
  return yield* takeNext()
})
```

On enqueue: complete `wakeSignal` (then recreate it). Workers re-enter priority poll.

### 5.3 Item processing

```typescript
const processItem = Effect.fn("QueueResource.processItem")(function*(item: T) {
  yield* semaphore.withPermits(1)(
    Effect.gen(function*() {
      // Rate limit (if configured)
      if (rateLimiter) {
        yield* rateLimiter.consume({ key: queueName, onExceeded: "delay" })
      }

      const start = yield* Clock.currentTimeMillis
      const exit = yield* Effect.exit(config.effect(item))
      const elapsed = Duration.millis((yield* Clock.currentTimeMillis) - start)

      yield* Ref.update(completedCount, (n) => n + 1)

      // Dedup key release
      if (config.key) yield* Ref.update(activeKeys, HashSet.remove(config.key(item)))

      // Hook: onComplete
      if (config.onComplete) {
        yield* FiberSet.run(hookFibers, config.onComplete(item, exit, elapsed).pipe(Effect.ignore))
      }

      // Handler: FORKED — does not block the worker from taking the next item
      if (config.handler) {
        const handlerCtx = makeHandlerContext(item, internalItem._retries, exit)
        yield* FiberSet.run(handlerFibers, config.handler(item, exit, handlerCtx).pipe(Effect.ignore))
      } else if (Exit.isFailure(exit)) {
        yield* Effect.logWarning("Item failed, no handler configured").pipe(
          Effect.annotateLogs({ item: JSON.stringify(item), cause: Cause.pretty(exit.cause) })
        )
      }
    })
  )
})
```

### 5.4 EffectContext (guarded enqueue, self-enqueue protection)

The `effect` receives an `EffectContext` — not the raw queue handle. The context warns and drops attempts to re-enqueue the current item:

```typescript
const makeEffectContext = (item: T): EffectContext<T, R, E> => {
  const isSameItem = (candidate: T): boolean => {
    if (candidate === item) return true
    if (config.key && config.key(candidate) === config.key(item)) return true
    return false
  }

  const guardedEnqueue = (candidates: T | ReadonlyArray<T>, enqueue: (items: T | ReadonlyArray<T>) => Effect<void>) =>
    Effect.gen(function*() {
      const items = Array.isArray(candidates) ? candidates : [candidates]
      const safe = items.filter((c) => {
        if (isSameItem(c)) {
          Effect.runSync(Effect.logWarning("Self-enqueue detected, item dropped").pipe(
            Effect.annotateLogs({ queue: queueName })
          ))
          return false
        }
        return true
      })
      if (safe.length > 0) yield* enqueue(safe)
    })

  return {
    add: (items) => guardedEnqueue(items, realQueue.add),
    prioritize: (items) => guardedEnqueue(items, realQueue.prioritize),
    defer: (items) => guardedEnqueue(items, realQueue.defer),
  }
}
```

Usage — safe (derived items):
```typescript
effect: (order, ctx) => Effect.gen(function*() {
  const subOrders = yield* splitOrder(order)
  yield* ctx.add(subOrders) // ✅ different items
})
```

Self-enqueue attempt — warned and dropped (no crash):
```typescript
effect: (order, ctx) => Effect.gen(function*() {
  yield* ctx.add(order) // ⚠️ logged warning, item dropped, worker continues
})
```

### 5.4.1 HandlerContext (retry + unguarded enqueue)

The handler gets `HandlerContext` which includes `retry` — the **only** sanctioned way to re-process the same item:

```typescript
const makeHandlerContext = (item: T, currentRetries: number, exit: Exit<R, E>): HandlerContext<T, R, E> => ({
  retry: Effect.gen(function*() {
    if (currentRetries >= (config.retries ?? Infinity)) {
      if (config.onRetryExhausted) {
        yield* config.onRetryExhausted(item, Exit.isFailure(exit) ? exit.cause : Cause.empty)
      }
      return // exhausted — don't re-enqueue
    }
    // Re-enqueue at same priority, back of the line
    yield* enqueueInternal(item, originalPriority, currentRetries + 1)
  }),
  add: realQueue.add,        // unguarded — handler knows what it's doing
  prioritize: realQueue.prioritize,
  defer: realQueue.defer,
})
```

### 5.5 Deduplication

On enqueue:
```typescript
if (config.key) {
  const k = config.key(item)
  const keys = yield* Ref.get(activeKeys)
  if (HashSet.has(keys, k)) return // silently drop
  yield* Ref.update(activeKeys, HashSet.add(k))
}
```

Key released after processing (success or failure, after handler).

### 5.6 Rate limiting (Effect's `RateLimiter`)

```typescript
// During queue setup:
const rateLimiter = config.limit ? yield* config.limit : undefined

// Before each item:
if (rateLimiter) {
  yield* rateLimiter.consume({
    key: queueName,
    limit: /* from the RateLimiter instance */,
    window: /* from the RateLimiter instance */,
    onExceeded: "delay",  // block until slot available
  })
}
```

The user passes `RateLimiter.make(limit, window)` in config. The queue `yield*`s it during setup and calls `.consume()` before each item. Requirements (e.g. `RateLimiterStore`) propagate to the queue's layer type.

If no `limit` in config → no rate limiting.

### 5.7 Scope lifecycle

```typescript
QueueResource.make = (config) => Effect.gen(function*() {
  const highQueue = yield* InternalQueue.bounded<T>(capacity)
  const normalQueue = yield* InternalQueue.bounded<T>(capacity)
  const lowQueue = yield* InternalQueue.bounded<T>(capacity)
  const latch = yield* Latch.make(true)  // starts open
  const semaphore = yield* Semaphore.make(concurrency)
  const workerFibers = yield* FiberSet.make<void>()
  const handlerFibers = yield* FiberSet.make<void>()
  const hookFibers = yield* FiberSet.make<void>()

  // ... setup internals ...

  // Start workers
  for (let i = 0; i < concurrency; i++) {
    yield* FiberSet.run(workerFibers, workerLoop(i))
  }

  return queueHandle
}).pipe(Effect.annotateLogs({ "queue.name": config.name ?? "anonymous" }))
```

Scope close → `FiberSet`s interrupted automatically → workers stop, handlers stop, hooks stop. No manual finalizers.

---

## 6. Type system

### 6.1 Class factory signatures

```typescript
export declare const QueueResource: {
  Service: <Self, T, R, E = never>() =>
    <const Name extends string, RHandler = never, RItem = never>(
      name: Name,
      config: Config<T, R, E, RHandler, RItem>,
    ) => ServiceClass<Self, Name, Queue<T, R, E>> & { readonly layer: Layer<Self, never, RHandler | RItem> }

  Tag: <Self, T, R, E = never>() =>
    <const Name extends string>(name: Name) =>
      ServiceClass<Self, Name, Queue<T, R, E>>

  layer: <Self, T, R, E, RHandler = never, RItem = never>(
    tag: Context.Key<Self, Queue<T, R, E>>,
    config: Config<T, R, E, RHandler, RItem>,
  ) => Layer<Self, never, RHandler | RItem>

  make: <T, R, E, RHandler = never, RItem = never>(
    config: Config<T, R, E, RHandler, RItem>,
  ) => Effect<Queue<T, R, E>, never, Scope | RHandler | RItem>
}
```

### 6.2 Requirement propagation

Layer requirements = `RItem | RHandler | Rpersist | Rrefill | Rhooks` (all inferred from the config callbacks).

### 6.3 ProcessGroup compatibility

`QueueResource.Service` and `QueueResource.Tag` produce `Context.Key` instances. `ProcessGroup.make({ queues: [...] })` works unchanged.

---

## 7. Error types

```typescript
export class QueueShutdownError extends Data.TaggedError("QueueShutdownError")<{
  readonly queue: string
}> {}
```

Enqueue after shutdown → `QueueShutdownError`.

---

## 8. Full example

```typescript
import { Duration, Effect, Exit, Layer } from "effect"
import { QueueResource, ProcessGroup, Process, Polling, ProcessSchedule, ProcessStore } from "@nikscripts/effect-pm"

// ─── Declare queue (Service style — config baked in) ───

class EmailQueue extends QueueResource.Service<EmailQueue, Email, EmailResult, SmtpError>()("@app/EmailQueue", {
  effect: (email) => smtpClient.send(email),

  handler: (item, exit, ctx) =>
    Exit.match(exit, {
      onFailure: () => ctx.retry,  // re-enqueue — waits in line, not immediate
      onSuccess: (result) => Effect.logInfo(`Sent ${result.id}`),
    }),
  retries: 5,
  onRetryExhausted: (item) => Effect.logError(`Gave up on ${item.to}`),

  concurrency: 10,
  limit: RateLimiter.make(200, "1 minute"),
  key: (email) => email.messageId,

  persist: (items) => db.emailOutbox.insertMany(items),
  refill: (queue) => Effect.gen(function*() {
    const pending = yield* db.emailOutbox.findPending()
    yield* queue.add(pending)
  }),

  onEmpty: Effect.logDebug("Email queue drained"),
}) {}

// ─── Process that feeds the queue ───

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

// ─── Compose ───

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
  Effect.provide(Layer.mergeAll(EmailQueue.layer, ProcessStore.layer)),
  Effect.runPromise,
)
```

---

## 9. Test patterns

### Fast test layer

```typescript
const TestEmailQueue = QueueResource.layer(EmailQueue, {
  effect: (email) => Effect.succeed({ id: `test-${email.to}` }),
  concurrency: 1,
})
```

### Full mock

```typescript
const MockEmailQueue = Layer.succeed(EmailQueue, {
  add: () => Effect.void,
  prioritize: () => Effect.void,
  defer: () => Effect.void,
  size: Effect.succeed(0),
  sizes: Effect.succeed({ high: 0, normal: 0, low: 0 }),
  isEmpty: Effect.succeed(true),
  completed: Effect.succeed(0),
  pause: Effect.void,
  resume: Effect.void,
  shutdown: Effect.void,
  clear: Effect.succeed(0),
} satisfies QueueResource.Queue<Email, EmailResult, SmtpError>)
```

---

## 10. File scope

### Rewrite from scratch

| File | Contents |
|------|----------|
| `src/QueueResource.ts` | Factories, types, internals |
| `test/queue-resource.test.ts` | Full test suite |

### Minimal changes

| File | Change |
|------|--------|
| `src/index.ts` | Update exports |
| `src/Resource.ts` | Update umbrella delegation |

### Not touched

`ProcessGroup`, `RunResource`, `HttpApiResource`, `Process`, `ProcessStore`, `ControlService`, examples.

---

## 11. Migration guide

| Before | After |
|--------|-------|
| `const Q = QueueResource.make({ name, ... })` | `class Q extends QueueResource.Service<Q, T, R, E>()("@app/Name", { ... }) {}` |
| `QueueResource.make({ name })` (Tag-only) | `class Q extends QueueResource.Tag<Q, T, R, E>()("@app/Name") {}` |
| `Q.layer` | `Q.layer` (unchanged for Service) |
| `forkWith: (forked, item, queue) => ...` | `handler: (item, exit, ctx) => Exit.match(exit, { onFailure: () => ctx.retry, ... })` |
| `queue.deffered(items)` | `yield* queue.defer(items)` |
| `queue.next(items)` | `yield* queue.prioritize(items)` |
| `yield* queue.getCompleted()` | `yield* queue.completed` |
| `yield* queue.size()` | `yield* queue.size` |
| `yield* queue.sizeByPriority()` | `yield* queue.sizes` |
| `yield* queue.restart()` | `yield* queue.clear` |
| `QueueResourceInterface<T,R,E>` | `QueueResource.Queue<T,R,E>` |
| `QueueResourceInstance<T,R,E>` | `QueueResource.Queue<T,R,E>` |
| `import { Cause } from "@nikscripts/effect-pm"` | `import { Cause } from "effect"` |

---

## 12. Open questions

1. **`clear` return type** — `Effect<number>` (count cleared) or `Effect<{ high: T[]; normal: T[]; low: T[] }>` (items returned)? Recommendation: count only (cheaper, items may be large).
2. **`refill` trigger** — auto when empty, or also expose as `queue.refill` method? Recommendation: auto only for v1; add method in future if needed.
3. **Name in config for `QueueResource.make`** — should raw `make` accept an optional `name` for log annotations? Recommendation: yes, optional `readonly name?: string`.
4. **In-memory `RateLimiterStore`** — Effect's `RateLimiter.make` requires `RateLimiterStore` (typically Redis). Should we provide a simple in-memory store adapter for local-only use, or require users to bring their own? (Alt: if `RateLimiter.make` doesn't accept positional `(limit, window)` args directly, we may need a thin wrapper or our own local implementation matching the same interface.)

---

## 13. Implementation phases

### Phase 1: Core

1. `QueueResource.Queue` interface.
2. `QueueResource.Config` type (with conditional handler inference).
3. Internal `makeQueueEffect` using `FiberSet`, `Latch`, `Semaphore`, `Effect.fn`.
4. `QueueResource.make` (raw scoped Effect).
5. `QueueResource.layer` (builds `Layer.scoped`).
6. `QueueResource.Tag` (class factory, no layer).
7. `QueueResource.Service` (class factory + `.layer`).

### Phase 2: Features

1. Dedup (`key` field + `HashSet` tracking).
2. Auto-retry (`retries` + `onRetryExhausted`).
3. Persistence (`persist` + `refill`).
4. Hooks (`onEnqueue`, `onComplete`, `onEmpty`).

### Phase 3: Tests

1. Basic processing, batch, priority ordering.
2. Handler with Exit matching.
3. Pause/resume via Latch.
4. Shutdown (clean exit, QueueShutdownError on enqueue).
5. Clear (resets counter, empties queues).
6. Dedup (dropped duplicates).
7. Retry (auto re-enqueue, onRetryExhausted).
8. Hooks (fire-and-forget, error swallowed).
9. Layer swap patterns (Tag + layer, Service override).
10. ProcessGroup integration.

### Phase 4: Exports

1. `src/index.ts` — public API surface.
2. `src/Resource.ts` — umbrella update.

---

## 14. References

- Effect `Context.Service` — `class X extends Context.Service<X, Shape>()("key") {}`
- Effect `FiberSet` — scoped fiber collection with auto-cleanup
- Effect `Latch` — open/close gate for fiber coordination
- Effect `Effect.fn("name")` — named traced functions
- Effect `Data.TaggedError` — standard error pattern
- Effect `Exit.match` — result handling
