# RuntimeStorage adapter guide

`RuntimeStorage` is the swappable persistence boundary underneath
`ProcessStore`. Runtime modules write semantic data through `ProcessStore`;
`ProcessStore` normalizes those writes into `RuntimeRecord`s; storage adapters
persist and query those records.

Use this guide when implementing a new durable backend such as SQLite, Prisma,
Postgres, a remote service, or a test storage layer.

## Adapter responsibility

Implement `RuntimeStorageService` from `src/RuntimeStorage.ts`.

```typescript
interface RuntimeStorageService {
  readonly create: (record: RuntimeRecord) =>
    Effect.Effect<void, RuntimeStorageDuplicateRecordError>
  readonly read: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[]>
  readonly upsert: (record: RuntimeRecord) =>
    Effect.Effect<void, RuntimeStorageReadonlyRecordError>
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult>
  readonly delete: (query: RuntimeRecordQuery) => Effect.Effect<DeleteResult>
}
```

Do not implement `ProcessStoreInterface` directly for durable adapters. Provide
`RuntimeStorageService`, then wire it through `ProcessStore.layerRuntimeStorage`.
`ProcessStore` maps adapter-level `RuntimeStorageError`s into package-level
`ProcessStoreWriteError`s before semantic runtime modules decide whether to
handle, log, or ignore them.

```typescript
Effect.provide(
  program,
  Layer.provide(
    ProcessStore.layerRuntimeStorage,
    MyRuntimeStorage.layer(...),
  ),
)
```

## Record contract

Adapters must persist every `RuntimeRecord` field:

| Field | Notes |
| --- | --- |
| `id` | Stable primary key. Duplicate `create` must fail. |
| `type` | Semantic record type, e.g. `queue.entry.enqueued`. |
| `occurredAt` | When the runtime event happened. Default read ordering uses this. |
| `createdAt` | When the record was created in storage. |
| `runId` | Runtime run identifier. |
| `processType` / `processId` | Owning process/resource identity. |
| `subjectType` / `subjectId` | Optional target within the process/resource. |
| `key` | Optional dedupe or lookup key. |
| `indexA` through `indexH` | Generic indexed identifiers. |
| `indexNames` | Ordered mapping of index labels captured at write time. |
| `payload` | JSON payload. |
| `attributes` | JSON metadata. |
| `readonly` | Immutable-record marker for update/delete behavior. |

Use native JSON columns when available. Otherwise encode JSON losslessly as text.
Do not drop unknown JSON fields.

## Query behavior

Adapters must match `RuntimeStorage.memory` semantics:

- default read order is `occurredAt desc`,
- all predicates in `RuntimeRecordPredicate` are supported,
- multiple `orderBy` clauses are applied in order,
- `limit` and `offset` are supported,
- `create` fails with `RuntimeStorageDuplicateRecordError` when `id` exists,
- `upsert` fails with `RuntimeStorageReadonlyRecordError` when the existing
  record is readonly,
- `update` returns `{ matched, updated }`,
- `update` counts readonly rows as matched but does not modify them,
- `delete` skips readonly rows unless the predicate explicitly includes
  `Readonly.equals(true)`,
- `delete` returns `{ deleted }`.

## Suggested indexes

Durable SQL adapters should index:

- `id`,
- `runId`,
- `type`,
- `processType`, `processId`,
- `subjectType`, `subjectId`,
- `key`,
- `occurredAt`, `createdAt`,
- `indexA` through `indexH`.

Index choices may vary by backend, but broad scans should be avoidable for
common queries.

## Conformance tests

Every adapter must pass the shared conformance suite:

```typescript
import { describeRuntimeStorageContract } from "../test/runtime-storage.conformance"

describeRuntimeStorageContract("MyRuntimeStorage contract", makeStorage)
```

`makeStorage` must return a fresh isolated `RuntimeStorageService` for each test.
For file or database adapters, use a unique temporary database/path per test.

Recommended test commands:

```bash
pnpm run typecheck
pnpm vitest run test/runtime-storage.test.ts <adapter-test-file>
pnpm test
pnpm run lint
pnpm run build
```

Adapter-specific tests should also cover backend behavior that the generic
contract cannot see, such as file persistence across service instances or SQL
migration/schema creation.

## Packaging conventions

Use lowercase storage subpaths:

```text
@nikscripts/effect-pm/storage/<adapter>
```

When adding a built-in adapter:

1. add the implementation under `src/storage/` or a small dedicated module,
2. add an export entry to `package.json`,
3. add the entry to `tsup.config.ts`,
4. export public types from `src/index.ts` only when they belong on the root
   package surface,
5. add docs and a changeset.

## Current built-in adapter status

- `RuntimeStorage.memory` is the reference implementation.
- `SQLiteRuntimeStorage` (`@nikscripts/effect-pm/storage/sqlite`) is the first
  durable `RuntimeStorageService` adapter (SQLite via `@effect/sql-sqlite-node`
  and `effect/unstable/sql`’s `SqlClient`).
- `ProcessStore.layerRuntimeStorage` is the bridge from `RuntimeStorage` to
  module-facing `ProcessStore`.
- `ProcessStore.fileLayer` is **legacy** append-only NDJSON compatibility only
  (**do not use for new code**). It is not a `RuntimeStorage` adapter.
- `@nikscripts/effect-pm/Logs` persists structured group logs via
  `ProcessStore.layerRuntimeStorage` + SQLite.
- Prisma paths currently expose a placeholder. The legacy `EffectPmEvent`
  adapter is intentionally disabled until Prisma is rebuilt as a
  `RuntimeStorage` adapter over normalized `RuntimeRecord` rows.

## Backend guidance

### SQLite

SQLite is the recommended first durable adapter because it can be tested locally
without external services. A good implementation should provide:

- `SQLiteRuntimeStorage.make(...)`,
- `SQLiteRuntimeStorage.layer(...)`,
- `SQLiteRuntimeStorage.fromSqlClient(...)` when you already provide `SqlClient`,
- isolated test databases,
- a persistence-across-service-instances test,
`make` / `layer` tie the SQLite client lifetime to the caller’s `Scope` via
`Layer.buildWithScope`, so run them under `Effect.scoped` (or `@effect/vitest`
`it.live`) for the whole period you use the returned port. Schema installation
can fail with `SqlError`; other SQL failures on read/update/delete are turned
into defects so the public `RuntimeStorageService` error channel stays aligned
with the in-memory reference.

### Prisma

Prisma should not revive the old event-table adapter. It should define a
normalized runtime record model and implement `RuntimeStorageService` against
that model.

Keep compatibility exports only where they do not imply the old adapter is
usable.
