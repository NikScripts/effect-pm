---
"hyperlink-ts": minor
---

**CLI + TUI control surface** — `Hyperlink.cli(Group|record, …)` builds one Effect CLI tree: bare paths open the TUI when `hyperlink-ts/tui`'s `layer` provides `Tui` (`serviceOption`); full `<resource> <action>` paths run-and-exit. Shortcuts: `cli.run`, `cli.command`, `cli.byName`, `cli.leaves`, `cli.open`. Removed the old `makeHyperlinkCli` / `makeHyperlinkTui` / `resourcesByName` names (no shims).
