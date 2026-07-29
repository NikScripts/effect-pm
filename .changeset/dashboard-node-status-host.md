---
"hyperlink-ts": minor
---

Add public web `NodeStatusHost` (HealthBoard → NodeDetail → HyperService overlay stack) and re-export `NodeBar` / `HealthBoard` / `NodeDetail` from `hyperlink-ts/web` via `NodeStatus`. TUI exports `NodeMark` (and focus pane helpers) from `hyperlink-ts/tui`. Batteries `DashboardShell` wires through `NodeStatusHost`.
