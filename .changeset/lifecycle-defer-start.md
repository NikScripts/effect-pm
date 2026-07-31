---
"hyperlink-ts": minor
---

Lifecycle building blocks + deferred HyperService start.

- **`hyperlink-ts/Lifecycle`** — service-agnostic protocol: PascalCase `Role` / `State` Schema,
  Spec pipes (`Lifecycle.pause` → `"Pause"`, …). No kind-specific helpers.
- Tools discover controls + badge via `methodMeta.lifecycle` (`"State"` field success =
  `Lifecycle.State`).
- WorkPool + Daemon **consume** the blocks (expose `lifecycle` ref + stamp commands).
- **`Hyperlink.deferStart`** — Layer pipe; deferred WorkPools report `lifecycle: "Idle"`.
