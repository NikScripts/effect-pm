# Queue history & backfill — UI requirement for the toolkit

A request from the dashboard work for a **history/backfill surface** on the toolkit
`QueueResource`. Today the observability streams (`status` / `metrics` / `events` /
`logs`) are **live-only** (hot): a UI that connects — or a browser that refreshes —
sees only data emitted *after* it attached, so charts and log panes start empty.

The web dashboard works around this client-side (snapshots its in-memory history to
`localStorage`), but that only works because the demo's queues run in the browser. For
**server-hosted** queues (the location-transparent direction — `Resource.client(tag)`
against a remote host), the history has to come from the server. This doc specs that.

## The pattern: query-then-tail

This is how observability UIs (Grafana/Loki, etc.) avoid empty panels on load:

1. On connect, **query a recent range** to backfill — e.g. the last N minutes of
   windowed metrics + the last N log lines.
2. Then **subscribe to the live stream** for new data, starting at a cursor that
   continues from the backfill so there's no gap and no duplication.

So the contract needs a *query* alongside each *stream*.

## Proposed surface (additive — doesn't change the live streams)

```
// windowed metrics over a time range (the chart's backfill)
metricsHistory(range: { since: DateTime; until?: DateTime }): Effect<ReadonlyArray<QueueMetrics>>

// log lines, cursor-paged (the log pane's backfill + scrollback)
logs(range: { since?: DateTime; until?: DateTime; limit?: number }): Effect<ReadonlyArray<QueueLogEntry>>
logsSince(cursor: LogCursor, limit?: number): Effect<{ entries; nextCursor }>

// (optional, if events history is wanted too)
eventsHistory(range): Effect<ReadonlyArray<QueueEvent>>
```

Notes:
- **Same element schemas** as the streams (`QueueMetrics`, `queueLogEntry`,
  `QueueEvent`) — the UI reuses its renderers; only the source differs (a query for the
  past, the stream for the present).
- **Cursor** (offset or `(timestamp, seq)`) on logs so the UI can (a) page back through
  scrollback and (b) stitch backfill → live without gaps/dupes. The live stream should
  expose the cursor of each entry (or the query returns the "live from here" cursor) so
  the subscriber can `subscribe(after: cursor)`.

## Storage

The package already ships the adapters — `storage/sqlite`, `storage/redis`,
`storage/prisma`. The queue host writes each **metrics window** and **log line** (and
events, if surfaced) to the configured store, keyed by queue id + timestamp. The query
verbs read from it. So this is wiring an existing capability into the queue contract,
not new infrastructure.

- **Retention** belongs on the host config: keep N windows / N hours of metrics and N
  lines / N hours of logs per queue (drop older). Make it configurable; default to
  something modest (e.g. 1h metrics, 10k log lines/queue).
- `captureLogs` already gates whether logs are captured at all; history persistence
  should be a further opt-in (`persist: { metrics?, logs?, retention? }` or similar) so
  in-memory-only deployments pay nothing.

## Lighter alternative: a replay buffer on the streams

If full persisted history is more than wanted initially, a **bounded replay buffer** on
`logs` / `metrics` / `events` (replay the last N on subscribe) gives reconnecting UIs
*recent* history without a separate store or query API. This was already flagged in
`queue-contract-ui-review.md` (§3b). It doesn't cover deep scrollback or survive a host
restart, but it's a small change and removes the empty-on-attach problem for the common
case. The query API above is the full version; the replay buffer is the 80/20.

## What the UI will do with it

`live-queues` (and any real consumer) would, per queue, on mount:
- `metricsHistory({ since: now - 10m })` → seed the chart's history series.
- `logs({ since: now - 10m, limit: 500 })` → seed the log pane.
- then subscribe to `metrics` / `logs` from the returned cursor.

That replaces the client-side `localStorage` shim with real, shared, multi-device
history — and the dashboard UI doesn't change shape, only where the first page of data
comes from.

## Priority

Medium. Not blocking local-first UI work (the client shim covers the demo), but it's the
piece that makes the **remote** dashboard real — without it, every reconnect to a remote
queue starts blank. The replay buffer is the cheap first step; the query API is the one
that gives scrollback + survives restarts.
