---
"hyperlink-ts": minor
---

**CLI + TUI control surface** — `Hyperlink.cli` / `hyperlink-ts/cli`'s `cli` takes a `Group.Tag` (or `{ name: tag }` record). Bare paths open the TUI when `hyperlink-ts/tui`'s `layer` provides the optional `Tui` service; without it, bare paths fail as `TuiNotConfigured`. Full `<resource> <action>` paths still run-and-exit. `makeHyperlinkCli` remains as a deprecated alias.
