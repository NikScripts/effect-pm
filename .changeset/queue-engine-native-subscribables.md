---
"@nikscripts/effect-pm": patch
---

**Queue engine handle exposes `size`/`isEmpty` as reactive `Subscribable`s** (previously one-shot `Effect`s), matching the resource-contract shape. Read the current value via `handle.size.get` / `handle.isEmpty.get` and subscribe to live updates via `.changes`. `.get` keeps the authoritative one-shot computation (so behavior is unchanged); `.changes` projects the live `status` stream.

This lets the toolkit `layer`/`serve` adapter pass `size`/`isEmpty` straight through instead of re-deriving them, making the queue resource a clean **additive-only** template (engine natively matches the contract; the adapter only adds `metrics.query` history, enqueue `orDie`, and RPC) for other resources to follow. Direct `QueueResource.make(...)` consumers that read `handle.size` / `handle.isEmpty` should switch to `handle.size.get` / `handle.isEmpty.get`.
