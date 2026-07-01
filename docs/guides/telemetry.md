# Metrics — OTEL for pro tools, Telemetry for custom

Every effect-pm host emits into Effect's per-process **`Metric` registry** (queues, processes, API
clients, and Effect's own runtime metrics). That one registry feeds **two** independent sinks — pick per
need, or run both:

| | What | When |
|---|---|---|
| **OTEL export** | wire `@effect/opentelemetry`, push OTLP to a collector | you want a **professional** stack — Sentry, Grafana, Honeycomb, alerting, retention |
| **`Telemetry` resource** | serve the registry as a `Resource` (`snapshot` + `live`) | you want to build something **custom** in-app — a fleet page, a TUI, a `pm metrics` command — with no external infra |

They don't compete: same source, different readers. `Telemetry` is deliberately **thin** — it serves the
data; it does not retain, alert, or query. That's OTEL/Grafana's job.

## OTEL export (the professional path — doc only, no effect-pm dependency)

effect-pm ships **no** OTEL code: the metrics are standard Effect `Metric`, so they export as-is. Add
`@effect/opentelemetry` as a **peer** and provide its metric layer, pointing OTLP at your collector.
Representative wiring (check `@effect/opentelemetry` for the current layer names):

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

// wow's Sentry free tier: Sentry ingests OTLP — point the exporter at its endpoint + auth header
const TelemetryOtel = NodeSdk.layer(() => ({
  resource: { serviceName: "services-hub" },
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "https://<org>.ingest.sentry.io/api/<project>/otlp/v1/metrics",
      headers: { "x-sentry-auth": `Bearer ${process.env.SENTRY_DSN_TOKEN}` },
    }),
  }),
}));

// provide TelemetryOtel to your runtime — every Metric now exports to Sentry
```

Swap the exporter for Grafana/Honeycomb/Prometheus and nothing else changes. This is the path for
dashboards, alerting, and history.

## Telemetry resource (the custom path)

Declare a tag, serve it on each host, and read it anywhere with `Resource.client`.

```ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry";

// hostless — the dashboard reaches each host via client(FleetTelemetry, host)
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}

// serve it on a host (like a queue/process) — the sampler runs in the served scope
const host = Resource.serveAllHttp([Telemetry.serverEntry(FleetTelemetry)]).pipe(
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
);

// read it — snapshot (point-in-time) or live (~1s stream)
const program = Effect.gen(function* () {
  const t = yield* FleetTelemetry;
  const snap = yield* t.snapshot;             // MetricsSnapshot { ts, metrics: [...] }
  const roster = snap.metrics.find((m) => m.id === "queue_enqueued_total" && m.labels.queue === "roster");
});
// provided with: Resource.client(FleetTelemetry).pipe(Layer.provide(connectHttp(host, …)))
```

### The `MetricsSnapshot` envelope (the wire contract)

A tagged union — `counter` / `gauge` / `histogram` — each with `id` + `labels`, plus its state. Histogram
`buckets` are cumulative `[{ le, count }]`. (`Frequency`/`Summary` are deferred — added additively.)

```ts
type MetricDatum =
  | { _tag: "counter";   id: string; labels: Record<string,string>; count: number }
  | { _tag: "gauge";     id: string; labels: Record<string,string>; value: number }
  | { _tag: "histogram"; id: string; labels: Record<string,string>;
      buckets: ReadonlyArray<{ le: number; count: number }>; count: number; sum: number };
type MetricsSnapshot = { ts: number; metrics: ReadonlyArray<MetricDatum> };
```

### Fleet fan-out

Because each host serves its own `FleetTelemetry`, the **host axis is free** — it's *which* host you
connected to. `client(FleetTelemetry, host)` per host, stamp each snapshot with the host, then group/sum
by `{ host, id, labels }` — **overall** (sum across hosts), **per-host** (by connection), **per-label**
(by `client` / `status`). Configure the cadence via `Telemetry.layer(tag, { interval })` (default ~1s;
sliding buffer so a slow reader can't backpressure the sampler).

## Cardinality — keep labels cheap

`host` / `client` / `status` are low-cardinality — good. **Do not** add per-endpoint or per-entity labels
to metrics (a metric per URL or per queue entry explodes cardinality). Per-**entity** *current* state
(this queue's depth right now) is read from the entity's own `status`/`snapshot` stream, **not** from
Telemetry. Telemetry is for aggregate rates and counts across the host.

## History

`Metric` is live-only (no persistence). `snapshot`/`live` are live; retained history is an OTEL/collector
concern (or your own store), mirroring the queue's `metrics` vs `metricsHistory` split.
