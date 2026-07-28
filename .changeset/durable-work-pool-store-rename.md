---
"hyperlink-ts": major
---

Rename WorkPool durability port `DurableQueueStore` → `DurableWorkPoolStore` (and matching error / shape / SQLite symbols). Subpath is now `hyperlink-ts/DurableWorkPoolStore`. SQLite table is `durable_work_pool` (no migration from `durable_queue` — beta break).
