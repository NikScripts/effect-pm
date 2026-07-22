---
"hyperlink-ts": minor
---

**Store:** rename the implicit durable log journal shape from `log` to private `_logs` (Effect-style underscore field). Omit underscore-prefixed shapes from public handle / methods / shape-ref types so apps can own a shape named `log`. Read durable history via `Resource.logs` / `Logs.byNode` / `Logs.byResource` — not `handle.log`.
