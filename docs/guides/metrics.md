{#metrics title="Metrics" appliesTo=all}
# Metrics

Resources already emit into Effect's per-process `Metric` registry (queues, processes, HTTP
clients, runtime metrics). Two sinks read that registry:

| Sink | When |
|------|------|
| **OTEL export** | Professional stack — Sentry, Grafana, Honeycomb, alerting, retention |
| **[Telemetry](/docs/telemetry)** | Custom in-app glass — fleet page, TUI, `pm metrics` — no sidecar |

Telemetry is the Resource path: leaf `snapshot` / `live`, plus fleet `inFlightByNode` /
`fleetInFlight` when the tag is meshed. Cardinality stays cheap (`node` / `client` /
`status` labels; no per-entity metric ids). Per-entity *current* state still comes from that
entity's own `status` / refs — not from Telemetry.

See the [Telemetry guide](/docs/telemetry).
