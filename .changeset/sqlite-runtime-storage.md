---
"@nikscripts/effect-pm": minor
---

Add the first durable `RuntimeStorage` adapter at `@nikscripts/effect-pm/storage/sqlite`, backed by `better-sqlite3` with `SQLiteRuntimeStorage.make`, `SQLiteRuntimeStorage.layer`, and `SQLiteRuntimeStorage.fromDatabase` for advanced connection control.

Persist every `RuntimeRecord` field in SQLite, keep query semantics aligned with `RuntimeStorage.memory` via shared `selectRuntimeRecords` evaluation, and document the adapter in the runtime storage guide alongside conformance and persistence tests.
