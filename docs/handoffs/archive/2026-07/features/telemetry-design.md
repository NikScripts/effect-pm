# Design: Telemetry — a thin, custom, dashboard-native metrics surface

> **✅ BUILT (2026-07-01).** `src/Telemetry.ts` (`Tag` / `layer` / `serverEntry` + `MetricsSnapshot`
> envelope + sampler), subpath `@nikscripts/effect-pm/Telemetry`, guide `docs/guides/telemetry.md`,
> round-trip test `test/telemetry-serve.test.ts` (labeled counter round-trips via `snapshot` over RPC +
> `live` streams in-process). Fully **browser-safe** (pure Effect `Metric`/`PubSub` — no node deps), so
> the whole module is importable by the dashboard. OTEL stayed doc-only.

**Status:** design, pre-code. Walk + approve before implementation (see "Decisions" — ✅ locked vs ☐ to-walk).
**Consumer driver:** wow-sports (fleet metrics in the built-in dashboard/TUI; Sentry free tier via OTEL).

## Why (and why not the cancelled thing)

The 2026-06-19 bespoke **Telemetry + State** redesign was cancelled — nothing bespoke in the domain, use
Effect's built-in `spans` + `Metric`. This design honors that: it adds **no bespoke metric model**. It
serves Effect's `Metric.snapshot` over the transport we already have, so consumers can do something
**custom** with fleet metrics without standing up external infra.

## Architecture — one source, two sinks

```
   per-host Metric registry   (Effect built-in — queues, processes, api, runtime metrics)
   effect-pm owns SOURCE quality: rich names + low-cardinality labels
        │
        ├─→  OTEL export   = @effect/opentelemetry OTLP exporter, wired by the CONSUMER (peer dep)
        │                    → collector → Sentry / Grafana / anything     ← DOC ONLY, no bundled dep
        │
        └─→  Telemetry resource (snapshot + live, served per host)         ← we BUILD (thin)
                                 → custom: built-in dashboard/TUI, fleet page, `pm metrics`, alert bot
```

- **OTEL = the professional path.** Our metrics are standard Effect `Metric`, so they export as-is; the
  consumer adds `@effect/opentelemetry` and points OTLP wherever. effect-pm ships **no OTEL code and no
  OTEL dep** — only a guide (with wow's Sentry example). Don't reinvent Grafana.
- **Telemetry = the custom path.** A thin `Resource` serving the live snapshot; the consumer builds the UI.

## The `MetricsSnapshot` envelope (THE contract — shared with the UI/TUI; lock first)

Tagged union so histogram encoding stays honest. (Exact Schema v4 call sites verified at implementation.)

```ts
const Labels = Schema.Record(Schema.String, Schema.String);       // from Metric attributes
const MetricDatum = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("counter"),   id: Schema.String, labels: Labels, count: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("gauge"),     id: Schema.String, labels: Labels, value: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal("histogram"), id: Schema.String, labels: Labels,
    buckets: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])), // cumulative [boundary, count]
    count: Schema.Number, sum: Schema.Number }),
]);
const MetricsSnapshot = Schema.Struct({ ts: Schema.Number, metrics: Schema.Array(MetricDatum) });
```

Notes: `number | bigint` states encode to `number` (document the >2^53 caveat); `buckets` are cumulative;
`Frequency`/`Summary` metric types are **deferred** (add additively when a consumer needs them).

## The `Telemetry` resource + sampler

Hostless tag (served on every host; the dashboard reaches each via `client(Telemetry, host)`):

```ts
class Telemetry extends Resource.Tag<Telemetry>()("@nikscripts/effect-pm/Telemetry", {
  snapshot: Resource.query(MetricsSnapshot),   // encode(Metric.snapshot, now)
  live:     Resource.stream(MetricsSnapshot),  // Stream.fromPubSub(sampler)
}) {}

// layer(options?): forks ONE sampler into scope, wires snapshot/live
const sampler = Effect.gen(function* () {
  const hub = yield* PubSub.sliding<typeof MetricsSnapshot.Type>(8);  // slow subscriber can't backpressure
  yield* Effect.forkScoped(Effect.forever(Effect.gen(function* () {
    const ts = yield* Clock.currentTimeMillis;
    yield* PubSub.publish(hub, encode(yield* Metric.snapshot, ts));
    yield* Effect.sleep(options?.interval ?? Duration.seconds(1));
  })));
  return hub;
});
```

Served per host via the normal path (`Resource.serve(Telemetry, impl)` or a `serverEntry`); the sampler
fiber lives in the serve scope. **Host axis is free** — it's *which* host you connected to, no
runtime-identity service.

## Dashboard/TUI fan-out (data plane here; panels = UI agent)

```ts
// for each configured host: client(Telemetry, host) → live; stamp with host; group/sum by {host, id, labels}
```
We ship the client + a `byHost`/by-label aggregation helper; the UI agent builds overall / per-host /
drill-down panels in dash **and** TUI. Settle the envelope with them — it's the contract.

## Cardinality discipline (the cancelled-telemetry lesson, encoded)

- v1 labels: `host` / `client` / `status` — all low-cardinality. **`per-endpoint` deferred** (needs route-
  template normalization at the `HttpApiClient` dispatch or it explodes cardinality).
- Per-**entity** live state (this queue's depth) is read from the entity's own `status`/`snapshot`, **not**
  Telemetry. Telemetry = aggregate rates/counts across the host.
- `Metric` is live-only (no persistence/eviction). No history in v1; retained history is an OTEL/store
  concern, mirroring the queue's `metrics` vs `metricsHistory` split.

## Emit audit (source quality)

Queues already emit (`queue_enqueued_total`, `queue_processing_duration_ms`, …). Confirm process metrics
+ the `api_*` set (ApiMetrics may already cover the emit) use consistent names + safe labels. No new model.

## `ApiMetrics` (shipped) — untouched (B1)

Stays the **curated** API view (usage windows, top-N endpoints). Telemetry serves the **raw** registry
(including the same `api_*` counters). Two purpose-built surfaces; the dashboard treats ApiMetrics as the
authoritative curated API panel. Not folding it in — the curated view holds more than the raw registry, so
a full fold isn't derivable anyway.

## Files

`src/Telemetry.ts` (Tag + `MetricsSnapshot` schema + `layer`/sampler + serve), `src/index.ts` export +
`./Telemetry` subpath + `tsup.config.ts` + browser-safety (contract node-safe; sampler node-side), tests,
a guide (`docs/guides/telemetry.md` — "OTEL for pro tools, Telemetry for custom," with the Sentry OTLP
example). Dashboard/TUI panels = UI agent.

## Definition of done / gate

- `MetricsSnapshot` envelope locked (walked with the UI agent).
- `Telemetry` served over http; `snapshot` + `live` read via `client(Telemetry, host)`; **round-trip test**
  asserts real queue counters appear labeled in the snapshot.
- Sampler cadence configurable (default ~1s); sliding PubSub; test uses `it.live` (TestClock stalls sleep).
- Guide with the doc-only OTEL wiring (`@effect/opentelemetry` peer → Sentry).
- Gate: `typecheck` (0) · `effect-language-service diagnostics` (0) · `eslint` · `build` · `test`;
  changeset (new public module — `minor`). No `as` casts; explicit `export interface` for public types.

## Decisions

- ✅ **Doc-only OTEL** — no bundled dep, no helper; consumer wires `@effect/opentelemetry`.
- ✅ **A1** — standalone `Telemetry` now (forward-compatible with the eventual observability-tap; same
  envelope, so the later change is reading `tap.changes` instead of a local sampler).
- ✅ **B1** — `ApiMetrics` coexists untouched.
- ✅ **Thin** — serve the snapshot; no retention/alerting/query (that's OTEL/Grafana).
- ✅ Envelope shape = the tagged union above (histogram buckets cumulative `[boundary, count]`).
- ✅ Hostless `Telemetry` tag; dashboard fans out via `client(Telemetry, host)` per host.
- ✅ v1 metric types = counter/gauge/histogram (Frequency/Summary deferred, additive).
- ✅ Default sampler cadence ~1s, configurable; sliding PubSub.
- ✅ Subpath `@nikscripts/effect-pm/Telemetry`.

**All locked 2026-07-01 — building.**
