---
"@nikscripts/effect-pm": minor
---

**Queue store: merged full-capture + three-tier contract + analytics (breaking).** A queue's lifecycle
event log is now a full three-tier `Store` contract — the golden `Store` example.

Full-capture (breaking event model):

- The worker outcome is recorded **once**: `Completed { entry, success, elapsed }` **or**
  `Failed { entry, cause, elapsed }`, carrying a typed `Cause<E>` from the tag's `error` slot.
- **Removed the redundant `Exit` event** — `Completed` vs `Failed` already encodes success-vs-failure
  (reconstruct `Exit<A, E>` from the two if needed).
- The engine captures the worker's real result at the source (`exit.value` / `exit.cause`) and threads
  it straight in. Note: the worker is `Effect<void, E, R>` (fire-and-forget), so `Completed.success` is
  `void` today; a meaningful typed success value (workers returning `Effect<A, E, R>`) is a future
  enhancement. Typed **error** capture is live now.

Three-tier store:

- **Tier 1 — lean base:** one `event` shape over the shared `queueEvent` union + `record` / `events`.
- **Tier 2 — engine write-extension:** narrow typed writes (`enqueued` / `started` / `completed` /
  `failed` / `retryScheduled` / `retryExhausted`), each funnelling to `event.append`. The engine records
  via `Store.catchWriteErrors(Store.effects(tag.key, …))` — a store write hiccup logs + swallows and
  never breaks the queue.
- **Tier 3 — consumer analytics read-extension:** `QueueResource.store(tag)` registers the base plus 12
  pure derivations — `failures`, `deadLettered`, `inFlight`, `history`, `lastFailure`, `slowest`,
  `recent`, `since`, `stats`, `failureRate`, `latency`, and a live `changes()` stream.
  `QueueResource.store(tag, additions)` adds app-specific shapes on top.

See `docs/guides/queue-resource.md`.
</content>
