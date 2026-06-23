# QueueResource (toolkit) — UI review & contract gaps

Review of the `src/QueueContract.ts` surface (branch `rewrite/resource-toolkit`) against
what the control/observability UI actually needs. The UI is built around a single `View`
the widget renders, fed by the queue's `status` / `metrics` / `events` streams; this report
is what that mapping exposed.

Scope: the **contract** surface consumers see via `yield* MyQueue` — not the engine. Items
are ranked by impact on the UI. Section 4 (missing features) is the priority.

---

## 1. Confirmed intentional — keep it

**The `status` snapshot replacing a tri-state enum is the right call.** `queueStatus =
{ sizes, paused, inFlight, completed }` is strictly more useful than the old
`running | paused | stopped` enum the mocks used: it's a full instantaneous snapshot,
encodable, and carries `inFlight` (which the UI wants and didn't have). No change needed —
the UI adapts to it.

One convention to nail down (not a schema change): there's no `stopped`/`shutdown` value in
the snapshot, which is correct — but the UI needs a defined way to show "this queue was shut
down" vs "paused". Proposed: **after `shutdown`, the `status` stream completes** (and/or the
resource scope closes); the UI renders a terminated state when the stream ends. Please
confirm that's the intended lifecycle so the UI can rely on it.

---

## 2. Bug — enqueue verb shape (`add` / `prioritize` / `defer`)

The contract payload is `{ item: itemSchema }` and unwraps to a single item:

```ts
add: Resource.mutate(Schema.Void, { payload: { item: itemSchema } })
// impl: add: ({ item }) => handle.add(item)
```

This disagrees with the engine in two ways:

1. **Double-nesting.** The engine is `yield* queue.add(item)` (bare item). The contract makes
   it `queue.add({ item })`. The wrapper is contract-only friction; callers that read the
   engine docs get the wrong shape.
2. **Singular only.** The engine's `add` is `QueueEnqueue<T>` and accepts a **batch**
   (`guardedEnqueue(items, …)` — `add(items)`). The contract drops batching: you can only add
   one item per call, so bulk enqueue costs N round trips over RPC.

Fix direction: match the engine — accept a bare item **or** an array (`item | ReadonlyArray<item>`),
no `{ item }` wrapper. (Flagged already; noted here for the record + the batching angle.)

**Consider:** `add` / `prioritize` / `defer` currently return `Void`. Returning the assigned
`entryId` (and `key`, if present) would let a caller/UI correlate an enqueue with the later
`Enqueued` / `Completed` / `Failed` events for that entry. Right now there's no handle on what
you just enqueued.

---

## 3. Missing features (the priority — beyond the known `logs` / `enqueueEncoded`)

### 3a. Per-priority latency in `metrics` — **the main gap**

`queueMetrics` exposes a single optional `avgLatencyMillis`. The UI was specified (and built)
to show **average wait per priority** — `high` / `normal` / `low` each have their own wait row
in the widget. There is no per-priority latency anywhere in the contract (`status` has
per-priority *sizes* but no timing; `metrics` has one overall latency). This is the one place
the shipped schema can't back the intended UI.

### 3b. Wait-vs-execution split + define `avgLatencyMillis` semantics

The UI distinguishes three timings (per the original spec): **wait** (time queued before a
worker picks it up), **execution** (worker processing time), and **total** (wait + execution,
shown full-screen). `queueMetrics` has only `avgLatencyMillis`, and its meaning is undefined —
is it wait, execution, or end-to-end? The UI can't label it correctly as-is.

Proposed `queueMetrics` additions (additive, keeps existing fields):

```ts
avgWaitMillis:      { high: number; normal: number; low: number }, // queue wait, per priority
avgExecutionMillis: Schema.optionalKey(Schema.Number),             // worker processing, overall
// rename/define the existing field as end-to-end:
avgTotalMillis:     Schema.optionalKey(Schema.Number),             // wait + execution, overall
```

(Optional-key where a window may have no completions, matching the current `avgLatencyMillis`.)

### 3c. One-shot `status` read

`status` is **stream-only**; the reads are `size` / `sizes` / `isEmpty` / `completed`. To get
`paused` / `inFlight` for a one-shot render — a CLI `status` subcommand, a non-`--watch` print,
or a widget's first paint before the stream warms up — a consumer must subscribe and `take(1)`.
A `Resource.query(queueStatus)` companion to the stream (or `paused` / `inFlight` as queries)
removes that. Low effort, broadly useful.

### 3d. Known pending (listed for completeness)

- `logs` stream — acknowledged; the UI reserves a pane for it.
- `enqueueEncoded` (receive side of handoff) — acknowledged; `releaseEncoded` (send side) ships.
- One-call remote serve helper — acknowledged; client side is complete.

---

## 4. Minor / naming

- **`changes` vs `status`.** Some UI comments (and an internal note) called the snapshot stream
  `.changes`. The queue's snapshot stream is `status`; `changes` is the separate, generic
  Resource-level stream. The UI side will correct its own comments — no contract change.
- **No `Retried` event.** Confirmed intentional (the doc notes the non-encodable `retry`
  affordance was dropped). The UI's mock had a `retry` log line; it will instead surface retries
  from `metrics.retried` (a counter) and the `Failed` events. Calling it out so we don't expect a
  discrete retry event.

---

## 5. Already well-aligned (don't touch)

- **`events` carry rich entries.** `queueEntry` = `{ item, entryId, key?, priority, attempts,
  timestamps, … }`, and `Completed` / `Failed` add `elapsed` / `cause`. That's everything the log
  tail needs (id, priority, attempts, elapsed, failure cause) — no gaps here.
- **Direct maps:** `sizes` (per-priority pending), `completed`, `inFlight`, `throughputPerSec`,
  and the per-window event counts (`enqueued/started/completed/failed/retried/deadLettered/dropped/
  rateLimitExceeded`) all map straight into the widget. The windowed `metrics` cadence is exactly
  right for building the sparkline (UI accumulates windows).
- **Local-vs-remote layer swap.** The `Resource.client(tag)` ↔ `QueueResource.layer(tag, …)`
  interchangeability is the property the UI is built on — the widget depends on the tag only.
  This is the design we want; nothing to change.

---

## Summary of asks

| # | Item | Type | Priority |
|---|------|------|----------|
| 2 | `add`/`prioritize`/`defer`: bare item + batch, no `{ item }` wrapper | bug | high |
| 3a | Per-priority `avgWaitMillis` in `metrics` | missing | high |
| 3b | `avgExecutionMillis` + define/rename `avgLatencyMillis` (total) | missing | high |
| 3c | One-shot `status` query (`paused`/`inFlight`) | missing | medium |
| 2 | Enqueue verbs return `entryId`/`key` | enhancement | medium |
| 1 | Confirm `status` stream completes on `shutdown` | clarify | low |
| 3d | `logs`, `enqueueEncoded`, serve helper | known pending | — |
