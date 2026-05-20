# RuntimeStorage adapter guide

## Status

`RuntimeStorage` is ready for adapter work.

The stable adapter boundary is `RuntimeStorageService` in `src/RuntimeStorage.ts`.
Adapters should implement normalized `RuntimeRecord` persistence, not the old
analytics/event table shape.

Start adapter work from:

```text
origin/cursor/grill-queue-v2-plan-b6d7
```

That branch contains:

- `RuntimeRecord` and `RuntimeStorageService`,
- `ProcessStore.layerRuntimeStorage`,
- `test/runtime-storage.conformance.ts`,
- the disabled legacy Prisma event-table adapter.

## Contract

Implement this service:

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

Do not expose feature-specific storage APIs from adapters. Runtime modules use
`ProcessStore`; `ProcessStore` maps semantic writes to generic `RuntimeRecord`s.

## Record shape

Every adapter must persist all `RuntimeRecord` fields:

- `id`, `type`, `occurredAt`, `createdAt`, `runId`,
- `processType`, `processId`,
- `subjectType`, `subjectId`, `key`,
- `indexA` through `indexH`,
- `indexNames`,
- `payload`, `attributes`,
- `readonly`.

`payload` and `attributes` are JSON values. Store them with a real JSON type
when available, or losslessly encode/decode JSON text.

## Query semantics

Adapters must match `RuntimeStorage.memory` semantics:

- default read order: `occurredAt desc`,
- support all current `RuntimeRecordPredicate` variants from `src/Query.ts`,
- support multi-column `orderBy`,
- support `limit` and `offset`,
- `create` fails on duplicate `id`,
- `upsert` fails when an existing record is `readonly: true`,
- `update` counts `matched` rows and skips readonly rows,
- `delete` skips readonly rows unless the query predicate explicitly includes
  `Readonly.equals(true)`.

## Conformance tests

Every adapter must pass:

```typescript
import { describeRuntimeStorageContract } from "../test/runtime-storage.conformance"

describeRuntimeStorageContract("RuntimeStorage.<adapter> contract", makeStorage)
```

`makeStorage` must return a fresh `RuntimeStorageService` per test. For file or
database adapters, use a unique temporary database/path per test so rows do not
leak between cases.

Run at minimum:

```bash
pnpm run typecheck
pnpm vitest run test/runtime-storage.test.ts <adapter-test-file>
pnpm test
pnpm run lint
pnpm run build
```

## SQLite first

Build SQLite before Prisma because it can be tested without external services.

Recommended shape:

- add a new subpath such as `@nikscripts/effect-pm/storage/sqlite`,
- provide `SQLiteRuntimeStorage.make(...)` and `SQLiteRuntimeStorage.layer(...)`,
- use a local file path or `:memory:` style database for tests,
- create a normalized `RuntimeRecord` table with indexes on:
  - `id`,
  - `runId`,
  - `processType`, `processId`,
  - `subjectType`, `subjectId`,
  - `key`,
  - `occurredAt`, `createdAt`,
  - `indexA` through `indexH`.

Use the current Effect / platform APIs in this repo. Inspect `repos/effect/`
before guessing APIs. If a SQLite package is needed, add the latest appropriate
Effect SQLite dependency with `pnpm`.

## Prisma later

Do not revive the old Prisma `EffectPmEvent` adapter.

The current Prisma ProcessStore surface intentionally fails with
`PrismaProcessStoreUnavailableError` until Prisma is rebuilt as a
`RuntimeStorage` adapter over normalized `RuntimeRecord` rows.

When implementing Prisma:

- add/replace schema around a runtime record table, not `EffectPmEvent`,
- implement `RuntimeStorageService`,
- pass the same conformance suite,
- expose the adapter through `@nikscripts/effect-pm/storage/prisma`,
- keep compatibility exports only where they do not imply the old event adapter
  is usable.

## ProcessStore integration

After an adapter provides `RuntimeStorage`, applications can wire:

```typescript
Effect.provide(
  program,
  Layer.provide(
    ProcessStore.layerRuntimeStorage,
    SQLiteRuntimeStorage.layer(...),
  ),
)
```

Adapters should not implement `ProcessStoreInterface` directly.
