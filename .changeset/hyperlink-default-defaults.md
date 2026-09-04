---
"hyperlink-ts": major
---

Replace `Hyperlink.pure` with Tag-baked `Hyperlink.default(value)` (singular Spec leaf) and piped `Hyperlink.defaults({…})` (multiple extras). Defaults merge onto local/client handles; Spec∩defaults collisions throw `DuplicateDefaultKey`. Layer/serve accept optional defaults overrides. Piped bag keys type via `DefaultsOf` / `WithDefaults` (class-extends cannot widen `Service`).
