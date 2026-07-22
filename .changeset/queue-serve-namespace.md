---
"hyperlink-ts": patch
---

**Fix: `QueueResource.serve` now resolves.** The beta.19 engine-`serve` for queues was added to
`QueueContract` but not re-exported through the `QueueResource` namespace, so `QueueResource.serve` (as
written in the changeset, example, and docs) didn't exist — only `QueueContract.serve` did, asymmetric
with `ScheduledProcess.serve`. Re-exported `serve` through `QueueResource` so the two match and the docs
are correct as written.
