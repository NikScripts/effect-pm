# Handoff: Telemetry resource — distributed, dashboard-native metrics

Every host serves its metrics; the dashboard/TUI fans out across **all** hosts (including remote)
and aggregates — **overall**, **per-host**, and **per-label** (client / endpoint / status). This is
the backbone that makes ApiResource (and queue/process) metrics dashboard-native from day 1.
Branch: `rewrite/resource-toolkit`.

## Vision (from the user)
Live metrics on API usage + as much relevant data as we can capture, shown in the dash **and** TUI,
aggregated across all instances including remote — overall, per host, and as granular as we can get.

## Architecture — three pieces

### 1. Emit → the Effect `Metric` registry (richly labeled)
Every resource emits to the per-host `Metric` registry (the queue already does:
`Metric.counter("queue_enqueued_total", …)` etc.). ApiResource adds
`api_requests_total` / `api_in_flight` (gauge) / `api_request_duration` (histogram) /
`api_errors_total`, tagged `client` + `status` (+ `endpoint`, see granularity). Process metrics
similarly. One shared registry per host — Effect aggregates it for free.

### 2. Serve → a `Telemetry` resource (one per host)
```ts
class Telemetry extends Resource.Tag<Telemetry>()("@pkg/Telemetry", {
  snapshot: Resource.query(MetricsSnapshot),   // whole registry, point-in-time
  live: Resource.stream(MetricsSnapshot),      // periodic push (~1s sampling of Metric.snapshot)
}, SomeHost) {}
const layer = Telemetry.layer(Telemetry);      // reads Metric.snapshot, encodes to wire
```
Source: **`Metric.snapshot: Effect<ReadonlyArray<Metric.Snapshot>>`** (verified in effect@4.0.0-beta.69).
Each `Metric.Snapshot` is `{ id, type, description?, attributes?, state }` — `attributes` are the
labels; `state` is per-type (counter `{count}`, gauge `{value}`, histogram `{buckets,count,sum}`).
`live` forks a fiber sampling `Metric.snapshot` on an interval and pushing to a sliding PubSub
(mirror the queue's `metrics` stream pattern). Served on **every** host (bound to that host's `Host`).

`MetricsSnapshot` wire schema = `ReadonlyArray<{ id, type, labels: Record<string,string>, ... per-type
state ... , ts }>` — a `Schema` encoding of `Metric.Snapshot` (counters/gauges/histograms).

### 3. Aggregate → dashboard / TUI fan-out
The dashboard already does multi-host (`connectHttp` per `Host`). It clients **each** host's
`Telemetry`, and the **host axis is free** — it's *which* host the snapshot came from (no
runtime-identity service needed). Then group/sum:
- **overall** = sum across hosts,
- **per-host** = group by the connection,
- **per-client / per-endpoint / per-status** = group by label.

```ts
// for each configured host: yield* Telemetry (via connectHttp(host)) → live
// stamp each datum with that host's name; group/sum by {host, client, endpoint, status}
```

## Granularity ladder
`host → client → endpoint → status`. Host (connection), client (tag id), status (transport) are
cheap. **Per-endpoint** needs instrumenting at the `HttpApiClient` dispatch (the transport sees only
method+URL; parameterized paths blow up cardinality) or normalizing route templates — **stretch
within v1**; land host/client/status first.

## Design notes / decisions
- **Host axis = dashboard-assigned** (which Telemetry endpoint), so **no dependency** on the
  roadmap's runtime-identity item.
- `live` cadence configurable (default ~1s); use a sliding PubSub so a slow subscriber can't
  backpressure.
- Telemetry is **independent of ApiResource** — it works with queue metrics alone, so it can ship
  first; ApiResource emit (see `api-resource-metrics.md`) just adds more labels to the same surface.
- Reuses `Resource` + `connectHttp` + the multi-host transport the UI agent already built.

## Coordination
- **UI agent** builds the aggregation panels (overall / per-host / drill-down) in dash **and** TUI —
  settle the `MetricsSnapshot` wire shape with them (it's the contract).
- Pairs with `api-resource-metrics.md` (the emit side) and the existing `history-and-persistence`
  guide (for retained history vs live).

## Files
`src/Telemetry.ts` (Resource.Tag + `layer` reading `Metric.snapshot` + the sampling fiber), the
`MetricsSnapshot` schema, `src/index.ts` export + `./Telemetry` subpath + `tsup.config.ts`, tests,
a guide section. Dashboard/TUI panels = UI agent.

## Gate
config-1 + config-2 (`tsgo` both = 0), `pnpm lint`, `pnpm build`, `pnpm test`; changeset (new public
module). Round-trip test: serve `Telemetry` over http, read `snapshot`/`live` via `Resource.client`,
assert queue counters show up labeled.
