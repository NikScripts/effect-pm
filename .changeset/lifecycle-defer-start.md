---
"hyperlink-ts": minor
---

First-class Lifecycle.Service + deferred HyperService start.

- **`Lifecycle.Service`** — `state` / `start` / `pause` / `resume` / `stop`
- **Impl:** `Lifecycle.make({ onStart, onPause?, onResume?, onStop, afterStop })`
- **Tools:** `Lifecycle.of(handle)` / `Lifecycle.from(Tag)`
- PascalCase `Role` / `State` + Spec stamps; `methodMeta` for wire discovery
- Daemon toolkit layer uses `make`; WorkPool projects via `of`
- **`Hyperlink.deferStart`** — Layer pipe → `initial: "Idle"`
