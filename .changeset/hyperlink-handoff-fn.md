---
"hyperlink-ts": minor
---

Handoff is now a serve-site **function** returning outcomes, not a tag strategy string (Locked #39). This retires `Hyperlink.withHandoff("drainOnly" | "workPoolRelease")`, `handoffOf`, the `HandoffStrategy` type, and the library strategy runners.

- Pass a handoff via `Hyperlink.serve(tag, impl, { handoff })` (the third argument is either an `AnyNode` — sugar for `{ node }` — or a `{ node?, handoff? }` options bag). `Daemon` / `Gate` may nest `handoff` in their layer config.
- `HandoffFn = (from, to, ctx) => Effect<void | HandoffOutcome>`, where `from` is the local handle and `to` is a peer client of the same HyperService (dialed from the Directory, self excluded by dial).
- Outcomes are tagged (`_tag` PascalCase): `Done` (handed off — the node may leave and shut down), `Retry` (bounded re-run of that HyperService's handoff), `Defer` (keep the node up). Build them from `Hyperlink.handoffContext` (`ctx.done` / `ctx.retry` / `ctx.defer`); returning `void` coerces to `Done`.
- Runs on the outgoing node during `Node.shutdown` after drain and before Lookup leave. On deferral, the node restores its `running` phase, does **not** leave membership, and `Node.shutdown` fails with typed `Hyperlink.HandoffDeferred` (`_tag: "HandoffDeferred"`). `.reason` is PascalCase via `Hyperlink.handoffDeferralReason`: `Defer` | `NoPeer` | `RetryExhausted` | `Failed` (match `_tag` / `.reason`, never message strings).
- `WorkPool.serve` / `serveRemote` **always bake** `WorkPool.releaseEnqueueHandoff` (release → peer `enqueue`). No config opt-out yet.
