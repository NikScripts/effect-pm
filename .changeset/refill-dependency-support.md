---
"hyperlink-ts": patch
---

Fix `QueueResource` refill dependency support: a refill `load` can now require its **own**
services, independent of the worker `effect`. Previously `load` and `effect` shared one `R` type
param, and because the requirement channel is contravariant TS inferred their **intersection** —
so any service the worker didn't also use collapsed to `never` and `load` failed to type-check.

The toolkit `QueueLayerConfig` now carries a separate refill requirement `RR` (return-position
only, so it infers cleanly); `QueueResource.layer` / `server` / `serveHttp` / `serverEntry` surface
the **union `R | RR`**. Runtime behavior is unchanged (the loader always ran in the queue's ambient
context). Regression test: `test/queue-refill-deps.test.ts`.
