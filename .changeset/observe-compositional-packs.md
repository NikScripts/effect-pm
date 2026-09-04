---
"hyperlink-ts": patch
---

Rewrite remaining UI observe packs as compositional `Observe` recipes (`PriorityView.pack`, `DaemonView.pack`, `ApiMetricsView.pack`, `GateView.pack`, and polled FleetHealth/Telemetry/ShardMap packs). `*Bundle` builders in `ui/data` are thin wraps over those packs.
