# Queue persistence — design

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

---

## Decisions locked (2026-07-05) — optionality model

The two planes take **opposite** optionality models, and it's principled, not inconsistent:
an in-memory form is *coherent* for observability but a *contradiction* for durability.

**Observability plane → baked-in default store (no serviceOption).**
- The queue **always** holds an event/metric store; the default backing is **in-memory, bounded**.
  Absence is never a state the engine reasons about — there is always a store.
- Override by supplying the in-memory backing with different options (retention, etc.), including
  **retain-nothing**. Swap the backing to SQL for durable history.
- Appends are **buffered off the worker hot path** (bounded, lossy-under-load by design).
- A dedicated `none` backing combinator (true no-op appends for a hot queue) is **deferred** — a
  bounded in-memory ring is already near-zero cost; add `none` when a real need appears.

**Durability plane → serviceOption (presence-driven).**
- Durability can't have a meaningful in-memory default (the whole point is surviving restart), so
  it is **not** baked in. A `DurableQueueStore` in context **+ an `itemSchema`** ⇒ durable; nothing
  in context ⇒ the normal ephemeral in-memory queue. **Providing the layer is the switch** — no
  `persist: true`.
- The retained `persist` field is now escape-hatch/tuning only: `false` = opt this queue out even
  when a store is in context; `{ … }` = lease/maxAttempts/poll tuning; `true` = legacy no-op enabler.

**Status:**
- ✅ *Shipped in the engine:* durability is presence-driven via `serviceOption(DurableQueueStore)`.
  The **public `persist` field and `QueuePersistOptions` are removed** — the layer is the only
  switch; opting a queue out = scope the layer so it doesn't receive it; the dead-letter budget
  derives from the queue's `attempts` (SSOT). Typecheck (both projects) + Effect LS clean;
  `queue-durable.sqlite` + `queue-resource` green (81 tests, durable test uses the layer alone).
  **Breaking — needs a changeset.**
- ⏳ *Follow-ups (reviewed, not built):* the SQL priority-native durable table (below) replacing the
  current `DurableQueueStore` impl (also fixes the sync-codec-defect that wedges a queue on one bad
  row); lease/poll tuning onto the backend layer (engine defaults for now); the baked-in in-memory
  observability store (waits on the new `Store`/EventJournal landing).

---


The optimal-from-first-principles design for persisting a `WorkPool` (durability +
observability), and the decision on whether to build on Effect's `PersistedQueue` or
take it as inspiration.

## Goals

- **Durability:** no enqueued work is lost across a restart; **at-least-once** processing.
- **Observability backfill:** metrics / logs / events history survives, so a reconnecting
  or refreshing UI **backfills** (query-then-tail) and has scrollback.
- **Constraints that define "optimal":** never slow the worker hot path; fast boot;
  pluggable backend; **pay-for-what-you-use** (in-memory default); persistence lives on the
  **host** so the remote client only queries/streams (location-transparent).

**Non-goals (v1):** exactly-once (we give at-least-once + dedup); multi-host distribution
(single host; multi-worker lease refinement deferred); metrics downsampling (simple
retention first).

## Architecture: two planes

Persistence splits into two planes with *different shapes*, even if they share a backend:

| | Durability plane | Observability plane |
|---|---|---|
| Holds | pending + in-flight entries (what work remains) | events / windowed metrics / log lines (history) |
| Role | source of truth to run the queue | powers UI + audit |
| Latency | **hot path** — every enqueue waits on it | **tolerant** — batched/async, off hot path |
| Size | small, churns fast | high-volume, retention-bounded |
| Boot | **scan pending** (no replay) | not needed to run |
| Queries | n/a | range + cursor |

**Why separate:** fusing them into one event-sourced log makes every enqueue/complete a
history write *on the hot path* and forces boot to replay the whole log. Separated, each is
optimal — tiny-fast durability, fat-cheap-append observability — and you can run **one
without the other** (durable-but-ephemeral-history, or rich-history over an in-memory queue).

## Durability plane — a priority-native store

**Decision: build our own store, _inspired by_ Effect's `PersistedQueue`, not using it
directly.** (Rationale in the appendix.) `PersistedQueue` is a FIFO durable work queue;
priority is antithetical to its `take()` model. A priority-native single table makes
priority, dedup, escalation, sizes, and atomic ops all *native* instead of bolted-on.

**Schema** (one row per pending/in-flight entry):
```
id            -- opaque per-entry handle (not the dedup key)
key           -- dedup key (nullable); unique among live entries
priority      -- high | normal | low
sequence      -- monotonic insert order (FIFO within a priority)
attempts      -- retry count
locked_until  -- lease expiry; NULL/past = available
completed     -- terminal marker (or row deleted)
schema_version
payload, enqueued_at
```

**Operations:**
- **offer** = `INSERT` with dedup on `key` (`ON CONFLICT (key) DO NOTHING`), or **escalate**
  (`UPDATE priority` if a live entry with that key exists at a lower priority).
- **take** = atomically lease the top-priority available row:
  `UPDATE … SET locked_until = now+timeout, attempts = attempts+1
   WHERE id = (SELECT id … WHERE not completed AND locked_until < now
               ORDER BY priority, sequence LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`
- **complete** = delete / mark; **fail** = re-lease (attempts++) or route to DLQ at
  `maxAttempts`; **deadLetter / drop** = move / delete by selector.
- **sizes** = `COUNT … GROUP BY priority WHERE not completed` (native, for the dashboard).
- **recovery** = `locked_until < now` ⇒ redelivered (the at-least-once guarantee); a graceful
  restart clears locks so in-flight work resumes immediately.
- **schema version** per row; decode on `take`; reject/upcast on mismatch ("only accept work
  you can run").

**Semantics — stated loudly: at-least-once + dedup key.** Exactly-once would require the
worker's side effect to be transactional with the dequeue (impossible generically). On crash,
in-flight (un-acked / lease-expired) entries are redelivered; a consumer that supplies a `key`
(or writes an idempotent effect) avoids double work.

**Backends** (lift `PersistedQueue`'s proven per-backend mechanics):
- **SQLite** — single-writer, serialize (no `SKIP LOCKED` needed). (`@effect/sql-sqlite-node`
  already a dep.)
- **Postgres / MySQL** — `FOR UPDATE SKIP LOCKED`.
- **Redis** — the lock/Lua dance `PersistedQueue`'s Redis store demonstrates.
- **Memory** — for tests / local-dev.
One consistent semantics across all of them (unlike `PersistedQueue`, whose dedup scope
differs by backend — see appendix).

## Observability plane

- **Events** (the lifecycle union) → append; doubles as the per-entry timeline + audit.
- **Metrics** → store **pre-aggregated windows** (cheap charts) + simple time/count retention.
- **Logs** → append `(queueId, entryId, t, level, message)`.
- **Writes are batched/async off the hot path** (a relay/buffer drains to the store) — the
  worker never blocks on observability persistence.
- **Queries (host-side, for the UI):** `metricsHistory(range)`, `logs(range)` /
  `logsSince(cursor)`, `eventsHistory(range)` — same element schemas as the live streams.
- **Query-then-tail:** the UI queries a range to backfill, then subscribes to the live stream
  **from the returned cursor** (no gap, no dupes). The live tail can reuse a bounded replay
  buffer (the `HostLogs` pattern already in the tree).

## Contract surface (location-transparent)

Persistence lives on the **host** (where the engine runs). The remote client never touches the
store — it calls the existing commands/streams **plus the new history query verbs** over RPC.
Local-dev hits the same verbs against an in-memory/local store. The current browser
`localStorage` shim is the degenerate local case, to be **replaced by query-then-tail against
the host** once queues run server-side.

## Config / tiering (pay-for-what-you-use)

- In-memory by default — no persistence, no cost.
- **Durability** opt-in (`persist: { backend, retention, maxAttempts, … }`).
- **Observability** opt-in (`captureLogs` already; a metrics/events persistence flag).
- Backend pluggable **per plane** (e.g. durability in SQL, observability in SQL-with-TTL).

## Deferred tiers (clean add-ons, not rewrites)

- Multi-worker lease / visibility-timeout refinement (single host just re-leases on restart).
- Metrics **downsampling** (roll 1s → 1m → 1h for long retention).
- **Effectively-once** via an outbox / idempotency table.

## Open decision

The design assumes **strict priority** (matches the existing high/normal/low contract). If
**best-effort** priority were acceptable instead, we could skip the custom store and use a
single FIFO `PersistedQueue` directly — a real simplification. Flagged; defaulting to strict.

---

## Appendix — why `PersistedQueue` is inspiration, not the engine

`PersistedQueue`'s value is its `take()` consume loop (lease + `attempts`/`maxAttempts` +
lock-refresh + expiry-recovery). But priority needs to *choose which* item to take, and
`take()` offers no say — it's FIFO, with no priority selector, no `tryTake`, no `size`, no
timeout.

- **Triple-queue (one per lane):** cross-lane priority = racing `take`s (resolves to whichever
  lane produces first — *wrong order*) and interrupting losers, which on SQL/Redis can pin an
  item under its lease until `lockExpiration` (**default ~90s**). Dedup is **backend-divergent**
  (memory & SQL dedup globally by `id`; Redis dedups per-lane), so the cross-lane dedup contract
  isn't portable — and on memory/SQL, re-offering to escalate is **silently dropped**
  (`ON CONFLICT DO NOTHING`). No `size`, no atomic cross-lane moves.
- **Single-queue + priority field:** `take()` is FIFO, so you must bypass it and query the
  store yourself for the top-priority row — abandoning the one primitive worth using.

**What we lift as a blueprint:** the lease + lock-refresh + expiry-recovery pattern, the
`attempts`/`maxAttempts` retry, the poll loop, and the memory/SQL/Redis backend trio — applied
to a priority-native schema where dedup, escalation, sizes, and atomic ops are first-class.
