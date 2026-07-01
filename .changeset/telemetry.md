---
"@nikscripts/effect-pm": minor
---

**New: `Telemetry` — a thin, custom, dashboard-native metrics surface.** Serves a host's whole Effect
`Metric` registry as a `Resource` (`snapshot` query + `live` ~1s stream) so you can build **custom** in-app
metrics UIs — a fleet page, a TUI, a `pm metrics` command — with **no external infra**. It's the
counterpart to OTEL export: same source (the per-host `Metric` registry), different sink. OTEL
(`@effect/opentelemetry`, **doc-only** — no new dependency) is the professional path (Sentry / Grafana /
Honeycomb); `Telemetry` is the custom path.

```ts
import * as Telemetry from "@nikscripts/effect-pm/Telemetry";
class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}          // hostless
Resource.serveAllHttp([Telemetry.serverEntry(FleetTelemetry)]);            // serve per host
// read: (yield* FleetTelemetry).snapshot / .live  → MetricsSnapshot { ts, metrics: [...] }
```

`Telemetry.Tag` / `layer` / `serverEntry` + the `MetricsSnapshot` envelope (a tagged union of
counter/gauge/histogram with `id` + `labels`). The host axis is free (which host you connected to); fan
out across the fleet with `Resource.client(tag, host)`. Cardinality-disciplined — `host`/`client`/`status`
labels; per-endpoint/per-entity deferred (per-entity current state is read from the entity's own `status`,
not Telemetry). Thin by design: it serves the data, not retention/alerting/query — that's OTEL's job. See
`docs/guides/telemetry.md`.
