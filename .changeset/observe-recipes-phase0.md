---
"hyperlink-ts": minor
---

Add `Observe` (`hyperlink-ts/Observe`) — unbound recipes/packs with `bind` / `use` — plus family observe packs on service View modules (`WorkPoolView.pack`, `PriorityView.pack`, `DaemonView.pack`, `GateView.pack`, `ApiMetricsView.pack`, `FleetHealthView.pack`, `TelemetryView.pack`, `ShardMapView.pack`) and `NodeView.use` / `.bind` for `NodeRef`. Prefer `Observe.use(Jobs, WorkPoolView.pack)` over deprecated `Bundle.observe`. New package subpaths for each `ui/*View` + `ui/NodeView`.
