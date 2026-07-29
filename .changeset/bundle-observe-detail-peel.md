---
"hyperlink-ts": minor
---

**Bundles / detail peel:** `*Bundle` builders use `Hyperlink.atom` / `Hyperlink.fn` for live status and commands (history/trend/logs/schedule scans stay Bundle-owned). Web + TUI widgets/skins observe via `Bundle.observe` / `Bundle.node`. Dashboard detail routes share `DetailShell` (back + title); badges move into Detail skins (lock J). Kit `<Dashboard />` batteries remain HOLD.
