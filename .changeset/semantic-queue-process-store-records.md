---
"@nikscripts/effect-pm": minor
---

Add semantic `ProcessStore.QueueResource` helpers for queue entry, lifecycle, and dedupe-key records, and wire `QueueResource` to write indexed runtime records through `ProcessStore` when it is available.

Move the default in-memory `ProcessStore` backing store onto `RuntimeStorage`, with analytics reads projected from normalized records.

Remove `QueueResource`'s storage-oriented `persist` and `refill` callbacks in favor of `ProcessStore` storage and queue-bound `onStart` / `onDrained` lifecycle hooks.

Replace queue `handler`, `onEnqueue`, and `onComplete` callbacks with queue lifecycle envelopes such as `onEnqueued`, `onExit`, `onCompleted`, `onFailed`, and retry lifecycle hooks.

Add pending-entry queue routing controls: `release`, `drop`, and `deadLetter`, plus corresponding lifecycle hooks.

Add `releaseEncoded` for schema-backed remote/wire handoff while keeping local decoded `release` available without `itemSchema`.

Move Prisma storage onto the RuntimeStorage adapter over normalized RuntimeRecord rows.

Map `RuntimeStorage` write failures into `ProcessStoreWriteError` so semantic ProcessStore APIs can surface duplicate and readonly write errors explicitly.
