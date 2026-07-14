---
"@nikscripts/effect-pm": minor
---

**Queue handles now carry the tag's declared `Success`/`Error` types.** `yield* MyQueue` on a payload-only tag types as `QueueResource<Payload, void, never, never>` — the error channel is `never` (was `unknown`) and success is `void`, both driven by the tag's `success`/`error` schema slots rather than defaulting loosely. Declare `error: <Schema>` on the tag and the worker's failure type is constrained to it and surfaces on `events`' `Failed.cause` as a `Cause<Error>`.

Behavior change: a worker that can fail (`Effect.fail`) now only typechecks when its tag declares a matching `error` schema — otherwise the failure must be `orDie`d into a defect. The tag is the error contract; workers conform.

Cast-free: the named `QueueResource` contract carries the real types while the engine adapter rides its existing sanctioned erasure boundary (no engine-type surgery, net fewer casts). A `test/queue-handle.test-d.ts` soundness guard proves the threaded handle is bidirectionally equal to the raw contract.
