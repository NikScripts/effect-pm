---
"hyperlink-ts": minor
---

**Rename observability nested groups from `{ live, history }` to `{ stream, query }`.** Queue, CustomQueue, Process, and NodeStatus resources now expose `metrics.stream` / `metrics.query` and `logs.stream` / `logs.query` (replacing `*.live` / `*.history`). Wire method names follow (`logs.query`, etc.).
