---
"hyperlink-ts": minor
---

Lifecycle roles + deferred HyperService start.

- **`hyperlink-ts/Lifecycle`** — Spec method pipes (`Lifecycle.pause` / `start` / `resume` /
  `stop` / `state`) for generic management tools via `methodMeta.lifecycle`
- Shared **`Lifecycle.State`** badge + `fromWorkPool` / `fromDaemon` projections
- WorkPool + Daemon control Specs stamped with lifecycle roles
- **`Hyperlink.deferStart`** — Layer pipe (Policy-shaped, HyperService layers only); WorkPool /
  Daemon honor ambient `DeferStart` (call-site `autoStart` still wins when set)
- WorkPool `phase` gains `"idle"` when start is deferred
