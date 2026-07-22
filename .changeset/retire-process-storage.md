---
"hyperlink-ts": major
---

**Removed the legacy RuntimeStorage facet substrate (BREAKING).** Deleted public modules and subpaths for `ProcessStorage`, the facet `ProcessStore` builder, `ProcessStoreEvent`, `RuntimeStorage`, `Query`, `store/ProcessLifecycle`, and `storage/redis`, plus the SQLite `layerProcessStore` / `SQLiteRuntimeStorage` facade.

Use the EventJournal `Store` plane (`Store.Service`, `Process.store(tag)`, `LogStore.layer` / `LogStore.layerMemory`) and `@nikscripts/effect-pm/storage/sqlite` for `SQLiteDurableQueueStore` / `SQLiteHistoryStore`. Structural `JsonValue` now lives under `src/internal/json`.
