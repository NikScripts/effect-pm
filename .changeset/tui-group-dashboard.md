---
"hyperlink-ts": minor
---

Shared dashboard core on `hyperlink-ts/ui` (data bundles, group route resolve, atom-react, memberKind + wireKindOf, widget registry). `hyperlink-ts/web` and `hyperlink-ts/tui` are renderers over that SSOT — both accept `widgets?` via `forKind` / `forKey` / `withEntries`. TUI `<Dashboard runtime group path? />` opens from `Hyperlink.cli` bare paths via the optional `Tui` service, with grid/detail cells for queue, priority, daemon, gate, api, fleetHealth, telemetry, and shardMap.
