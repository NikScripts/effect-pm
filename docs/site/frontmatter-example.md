---
id: queues
title: Queues
appliesTo: all
rules:
  - id: enqueue-paused
    severity: should
  - id: dedup-key
    severity: may
---

# Queues

A `QueueResource` drains a stream of items through a handler effect, with
priority, de-duplication, automatic retry, and a pool of workers — all declared
on the tag.

## Define a queue

The handler `effect` runs per item. `key` de-duplicates in-flight items;
`attempts` re-enqueues on failure; `concurrency` sizes the worker pool.

```ts
class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, SendError>()(
  "app/EmailQueue",
  {
    paused: true,            // enqueue first, then resume — a common bootstrap
    concurrency: 4,
    key: (job) => job.id,    // dedup: same id is skipped while in flight
    attempts: 2,             // 1 initial + 1 retry, then dead-lettered
    effect: (job, ctx) =>
      Effect.log(`send ${job.id} (attempt ${ctx.attempts})`),
  },
) {}
```

> [!NOTE]
> Effect queues can't enumerate their pending items — you target what you know
> (`drop`, `deadLetter` by matching an item), and read counts (`size`,
> `completed`, per-priority `sizes`) rather than listing.

## Live

The dashboards render this same tag:

```queue
app/EmailQueue
```
