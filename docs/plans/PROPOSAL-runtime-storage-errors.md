# Proposal: RuntimeStorage durable error model

`RuntimeStorageService` currently exposes a small typed error union:

- `RuntimeStorageDuplicateRecordError`
- `RuntimeStorageReadonlyRecordError`

That is enough for memory storage and for domain write semantics, but durable
adapters also have operational failures: connection loss, permissions, corrupt
rows, schema drift, and transaction failures. Today those are defects (`orDie`)
in SQLite and Prisma.

## Goal

Keep domain code simple while giving applications an explicit way to handle
durable storage failures at the edge.

## Non-goals

- Do not make storage facets handle every database failure inline.
- Do not leak Prisma / SQLite driver-specific errors through public APIs.
- Do not widen only one adapter; the contract must change cross-adapter.

## Proposed public errors

Add durable-only errors to `RuntimeStorageError`:

| Error | When |
|-------|------|
| `RuntimeStorageDriverError` | Driver rejected a read/write after acquisition. |
| `RuntimeStorageDecodeError` | A persisted row cannot decode to `RuntimeRecord`. Include `id` when known. |
| `RuntimeStorageSchemaError` | Adapter detects missing/incompatible storage shape during bootstrap. |

Keep duplicate and readonly as the only *logical* write errors. The new errors
are operational, not domain decisions.

## Proposed service shape

Option A — direct widening:

```ts
read(query?): Effect<RuntimeRecord[], RuntimeStorageDriverError | RuntimeStorageDecodeError>
update(query, patch): Effect<UpdateResult, RuntimeStorageDriverError | RuntimeStorageDecodeError>
delete(query): Effect<DeleteResult, RuntimeStorageDriverError | RuntimeStorageDecodeError>
```

Option B — edge wrapper:

- Keep `RuntimeStorageService` unchanged for facets.
- Add `RuntimeStorageDurableService` with widened errors.
- Built-in durable adapters expose both, and `ProcessStorage.layerRuntimeStorage`
  consumes the defect-on-error view by default.

## Recommendation

Choose **Option A** before 1.0 if callers are expected to recover from storage
outages. It is honest: reads and writes already can fail in durable adapters,
and typed errors are better than defects for application supervision.

If preserving the current facet ergonomics is more important, choose **Option B**
and keep defects inside `ProcessStorage` while exposing a typed operational API
for apps that read storage directly.

## Migration steps

1. Add public tagged errors and update `RuntimeStorageError`.
2. Update memory adapter error channels to `never` where applicable or the wider
   union with no failures.
3. Update SQLite to map `SqlError` / decode failures into the new errors.
4. Update Prisma to map `PrismaRuntimeStorageDriverError` /
   `PrismaRuntimeStorageDecodeError` into the public errors.
5. Update `ProcessStore` static emit wrappers to keep logging write failures
   without changing domain success/failure semantics.
6. Add conformance tests for driver and decode failures.

## Open decisions

- Should corrupt selected rows fail the whole read or be skipped with an
  observability hook?
- Should schema/bootstrap failures live on adapter layer acquisition only, or
  also be part of a `RuntimeStorageService.health` check?
- Should batch writes be best-effort or atomic across all durable adapters?
