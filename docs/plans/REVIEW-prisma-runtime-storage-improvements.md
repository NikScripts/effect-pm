# Review report: Prisma `RuntimeStorage` follow-ups

**Branch:** `cursor/remove-xor-query-958b`  
**Baseline:** synced with `origin/cursor/dashboard-wow-planning-handoff-158c`  
**Do not merge:** `cursor/runtime-storage-sqlite-b6d7`

This review file now tracks the post-review status so future agents do not
repeat completed work.

---

## Completed in this branch

| Item | Status |
|------|--------|
| Branch alignment | Fast-forwarded to `origin/cursor/dashboard-wow-planning-handoff-158c` and pushed. |
| Broad updates/deletes | `update` uses `count` + `updateMany`; `delete` uses `deleteMany`; readonly skip semantics preserved. |
| Bounded write calls | Structural mock asserts broad update/delete use aggregate delegate calls, not one call per row. |
| Empty compound predicates | `And([])` is no-match across memory, SQLite, and Prisma; `Where()` remains the unfiltered path. |
| Empty patch | Prisma counts mutable rows without sending empty `updateMany` data. |
| Driver failures | Non-logical Prisma failures remain defects on the closed `RuntimeStorageService` port and are documented. |
| Decode failures | Selected corrupt rows die with internal `PrismaRuntimeStorageDecodeError` including row id; excluded corrupt rows do not affect good reads. |
| Date bounds | Explicit Prisma test covers exclusive `Between(start, end)` semantics. |
| Migration note | `docs/guides/MIGRATION-26b262b.md` includes the `EffectPmEvent` → `EffectPmRuntimeRecord` checklist. |
| CI notes | `docs/AGENTS.md` documents Prisma CLI / engine install requirements. |
| Handoff | `HANDOFF-grill-prisma-runtime-storage.md` now records implemented v1 plus v2 topics. |

---

## Still open: cross-adapter error model

Current durable adapters keep `RuntimeStorageService` typed failures limited to:

- `RuntimeStorageDuplicateRecordError`
- `RuntimeStorageReadonlyRecordError`

Everything else (driver failures, schema/corrupt-row decode failures, open/init
failures in some paths) is a defect. That keeps the port compatible with memory
storage, but it is not the best long-term operational model.

See [`PROPOSAL-runtime-storage-errors.md`](./PROPOSAL-runtime-storage-errors.md)
for the recommended cross-adapter plan.

---

## Future optional polish

1. Add `findUnique` to the structural delegate if it can be done without making
   generated Prisma clients fail structural assignment checks.
2. Consider gating generated-client Prisma integration tests if CI runtime
   becomes expensive. Default-on is preferable while the adapter is new.
3. Consider provider-specific index recommendations once a real consumer reports
   table sizes or query profiles beyond the current indexed columns.

---

## Verification command set

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Before release, confirm the existing changesets:

- `.changeset/prisma-runtime-storage.md`
- `.changeset/remove-runtime-query-xor.md`
