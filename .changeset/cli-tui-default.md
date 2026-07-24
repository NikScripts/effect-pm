---
"hyperlink-ts": minor
---

**CLI + TUI control surface** — `Hyperlink.cli(Group|record, name | { name, version })` builds one Effect CLI tree: bare paths open the TUI when `hyperlink-ts/tui`'s `layer` provides `Tui` (`serviceOption`); full `<resource> <action>` paths run-and-exit. Old `makeHyperlinkCli` / `makeHyperlinkTui` / `resourcesByName` names removed (no shims).
