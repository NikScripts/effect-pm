---
"hyperlink-ts": minor
---

**Process live `events` stream (persist == stream).**

- Add Queue-aligned `events: Resource.stream(...)` on `buildProcessSpec` / the process tag wire — same `Started | Completed | Failed | Interrupted` union as `Process.store` (`processExecutionEventFor` with tag `success` / `error`).
- Engine publishes every lifecycle fact to a sliding PubSub **and** appends to the store when wired (single `publishExecutionEvent` path).
- Handle surface: `yield* proc.events` (and `Process.make(…).events`). Tick / run-body failures emit `Failed` on the stream; typed `run` RPC remains the failure path; `start` / `stop` error channels unchanged.
