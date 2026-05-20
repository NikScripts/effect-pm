---
"@nikscripts/effect-pm": minor
---

Refactor the SQLite `RuntimeStorage` adapter to use Effect SQL (`effect/unstable/sql`’s `SqlClient` via `@effect/sql-sqlite-node`) instead of calling `better-sqlite3` directly from package code.

**Breaking:** `SQLiteRuntimeStorage.fromDatabase` is replaced by `fromSqlClient`, which installs the schema as an `Effect` and expects an existing `SqlClient`. `makeRuntimeStorage` / `layerRuntimeStorage` now require an ambient `Scope` (use `Effect.scoped` or `@effect/vitest` `it.live`) so the SQLite client lifetime matches the returned port; they use `Layer.buildWithScope` internally. `SQLiteRuntimeStorageOpenError` and direct `better-sqlite3` / `@effect/sql` 0.51 dependencies are removed from the package surface.

Duplicate primary key inserts map both `UniqueViolation` and SQLite `ConstraintError` (including `SQLITE_CONSTRAINT_PRIMARYKEY`) to `RuntimeStorageDuplicateRecordError`.

Persist every `RuntimeRecord` field in SQLite, keep query semantics aligned with `RuntimeStorage.memory` via shared `selectRuntimeRecords` evaluation, and document the adapter in the runtime storage guide alongside conformance and persistence tests.
