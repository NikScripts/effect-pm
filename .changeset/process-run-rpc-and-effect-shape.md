---
"@nikscripts/effect-pm": minor
---

**Process manual run RPC and Resource effect/effectFn shape.**

- Replace `runImmediately` with toolkit member **`run`** (`Resource.effect`, inputless) with per-tag typed `success`/`error` on the wire; failures fail the RPC `Effect` when an error schema is stamped.
- **`Resource.effect`** is inputless only (no `payload`); parameterized members use **`Resource.effectFn`**.
- Void lifecycle commands (`start`/`stop`/…) are `Resource.effect`; members with input (`logs.query`, schedule `get`/`has`, enqueue verbs, …) are `Resource.effectFn`.
- Observability nested groups renamed `{ live, history }` → `{ stream, query }` on Queue, CustomQueue, Process, and NodeStatus.
