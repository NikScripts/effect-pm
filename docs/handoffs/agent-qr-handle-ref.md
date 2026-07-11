# Agent — QueueResource handle: materialize `status` as a proper `ref` (match its own contract)

**Scope:** `src/internal/queueResource.ts` (and its mirror `src/CustomQueueResource.ts` — coordinate with the Queue wire Phase 1a agent, who is touching CQR). **Not** `docs/site/` (Agent B), **not** `src/web/*` (that's a downstream follow-on — see the end).
**Owner protocol (required):** get familiar first, then **post your plan in the owner chat and wait for approval** before building. Show all work in chat — real code + **before/after** for every change.

> ⚠️ Do **not** confuse this with the RETRACTED `agent-web-ui-refresh.md`. That brief was wrong (it told an agent to flatten `data.ts` toward bare streams + `statusNow`). This brief goes the **other** direction: fix the *engine handle* to expose the `ref` shape its contract already declares, so `data.ts` never has to redefine anything.

## The problem (verified at runtime + against source)

The queue's public **contract** already declares the ref shape:
- `src/QueueResource.ts:437` — `status: Resource.ref(queueStatus)` (also `size`/`isEmpty` as refs; `logs`/`metrics` nested with `.live` + `.history`).

But the local **handle** you `yield*` (`QueueHandle`) still exposes the *old* shape:
- `src/internal/queueResource.ts:433` — `readonly status: Stream.Stream<QueueStatus>` (a **bare stream**)
- `:440` — `readonly statusNow: Effect.Effect<QueueStatus>` (a **separate** Effect)
- built at `:3279`–`:3282` — `status: SubscriptionRef.changes(statusRef)`, `statusNow: computeStatus`

**Runtime probe** (`yield* Q`, run its `.layer`):
```
q.status         → bare Stream (isStream=true)
q.status.changes → undefined
q.status.get     → undefined
q.statusNow      → Effect (exists)
q.logs / q.metrics → bare Streams; .live undefined
```

**Proof this is the outlier, not the intended shape:** a plain `Resource.Tag` with `Resource.ref(Schema.Number)` materializes on its handle as `{ get, changes }` — verified (`c.value.get` / `c.value.changes` both work). The queue handle simply wasn't updated to match when the contract moved to `Resource.ref`; it still splits into a stream + `statusNow`.

**Consequence (reproduced):** `src/web/data.ts` reads `q.status.changes` / `q.logs.live` / `q.metrics.live` — all `undefined` on the queue handle → the dashboard widgets subscribe to nothing → **show no live data.** Mounted the shipped `QueueStats`/`QueueControls`/`LogStream` against a local queue: mounts clean, all zeros after enqueue.

## Your task

Make the queue handle expose `status` as a proper **subscribable** (`{ get, changes }`) matching `Resource.ref(queueStatus)`, instead of a bare stream + a separate `statusNow`. The backing `SubscriptionRef` (`statusRef`) is already there — surface it (e.g. `Resource.subscribable(statusRef)` / the same mechanism plain resources use) rather than splitting it. Do the same for `logs`/`metrics` if the contract intends the nested `{ live, history }` shape.

The owner's read (agreed): this is **small** — the ref backing exists; the impl just surfaces the wrong thing. It is **not** a rewrite.

Then:
- Update the few consumers that read `q.status` / `q.statusNow` today (one-shot CLI `status`, examples) to the ref shape (`status.get` for one-shot, `status.changes` for live).
- Keep `CustomQueueResource` in lockstep (it mirrors the same handle — the Phase 1a agent is editing it; coordinate to avoid collision).

## Verify (show in chat)
- Runtime probe: on a real handle, `q.status.get` is an Effect and `q.status.changes` is a Stream (no bare `q.status`, no `q.statusNow` on the public handle).
- The shipped widgets show **live** data off a local queue (status counts move on enqueue/drain).
- Typecheck + lint + tests green.

## Follow-on (NOT this task) — the SSOT fix in web
Once the handle is ref-shaped: `src/web/data.ts` should **derive** the handle shape from `QueueResource` (the `QueueHandle` type + the `queueStatus`/`queueMetrics` schemas), not hand-write its `QueueService` interface (line ~57). That hand-written interface is the SSOT violation that let this drift go unnoticed. Separate brief when the handle lands.
