# QueueResource — issues found during testing

This note records behavioral quirks and implementation issues discovered while writing `test/queue-resource.test.ts`. It is meant for maintainers and for a future hardening pass on `QueueResource`.

## 1. `restart()` used `Queue.takeAll`, which blocks on empty queues (fixed)

**Root cause:** In Effect v4, `Queue.takeAll` is implemented as `takeBetween(queue, 1, Infinity)` — it **waits until at least one element exists**. Calling `takeAll` on an **empty** queue therefore **blocks forever**.

**Symptom:** After processing all items (queues logically empty), `queue.restart()` never completed; tests timed out.

**Fix (in `QueueResource.ts`):** Clear each priority queue with a non-blocking drain (`poll` in a loop until `None`) instead of `Queue.takeAll`.

## 2. `isEmpty()` vs “workers idle on an empty queue”

**Symptom:** A test helper that waited until `getCompleted() >= n` **and** `isEmpty()` could spin until Vitest’s timeout in some scenarios, even though all enqueued items had finished.

**Likely cause:** When every priority queue has no *pending offers*, workers block inside `handleEmptyQueue` → `Effect.race` on `Queue.take` for the next item. Depending on Effect’s `Queue` implementation, `Queue.size` (used by `isEmpty`) may not treat that state the same as “logically empty” for the queue API, so `isEmpty()` may stay `false` while workers are simply waiting for work.

**Test implication:** `waitUntilProcessed` in `queue-resource.test.ts` uses `getCompleted() >= expected` only. Use `isEmpty()` as an extra assertion when the queue is known quiescent, not as a barrier combined with the count in a tight loop.

## 3. `pause()` and workers blocked in `Queue.take`

**Code path:** `createWorker` checks `isPaused` only at the **start** of each `Effect.forever` iteration. If the queue is empty, the worker blocks in `getNextItemBlocking` → `handleEmptyQueue` → `Queue.take` and does **not** observe `pause()` until it is woken by an offer.

**Consequence:** Calling `pause()` and then `add(...)` can still deliver items to a worker that entered `take` before `pause` was set, so work may run while the queue is notionally “paused.” Pause is best-effort relative to the take boundary, not a hard admission gate.

## 4. `restart()` semantics (queues + counter, not workers)

**What restart does:** Drains all three priority queues (non-blocking empty drain) and sets `processedCount` to `0` (see `QueueResource.ts`).

**What it does not do:** It does not stop or replace worker fibers, does not reset the semaphore, and does not cancel in-flight `processItem` or `forkWith` work. In-flight items can still complete and bump `getCompleted` after `restart()` if they were already running.

**Testing:** After fixing the `takeAll` deadlock (§1), the test suite asserts restart resets the counter when queues are already empty. Post-restart enqueue + wait remains a reasonable smoke test; if new edge cases appear, tighten the contract in code first.

## 5. `shutdown()` and `isRunning`

Workers consult `isRunning` at the **beginning** of each loop iteration, the same structural boundary as `pause`. If a worker is blocked in `Queue.take`, offers after `shutdown()` can still wake a `take` and lead to processing unless the implementation re-checks `isRunning` after every blocking point (it currently does not).

## 6. Worker loop when `!running`

When `isRunning` is false, the inner `Effect.gen` returns without exiting `Effect.forever`, so workers keep iterating (potential busy spin / tight loop depending on scheduler). This matches the current source; worth revisiting if CPU usage after shutdown is observed.

## 7. Default throttle in production config

The queue defaults to a conservative throttle (`limit: 1`, `duration: 1s` scaled by concurrency). Tests use an explicit `fastThrottle` so they stay fast. Callers who omit `throttle` should be aware of default pacing.

---

*Last updated from the QueueResource test pass and code review (Effect v4 beta).*
