---
"hyperlink-ts": patch
---

Remove the public `QueueHandle` type export from `hyperlink-ts/WorkPool`. The author-facing handle is `WorkPool<…>`; the engine TEMP alias remains internal-only (`EngineQueueHandle` / internal `QueueHandle`).
