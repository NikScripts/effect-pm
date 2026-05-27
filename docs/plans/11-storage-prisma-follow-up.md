# 11 — Storage and Prisma follow-up

## Status

**Prisma `RuntimeStorage` and operational errors are landed** on the integration
branch. This file tracks optional polish only — not a second adapter rewrite.

Authoritative shipped docs: [STORAGE.md](../STORAGE.md),
[MIGRATION-26b262b.md](../guides/MIGRATION-26b262b.md).

## Open polish

1. **`findUnique`** on hot paths if structural client typing still allows
   generated Prisma clients to assign without importing `@prisma/client` here.
2. **CI policy** for `test/prisma-runtime-storage.generated-client.test.ts` —
   keep in default `pnpm test` while the adapter is new; revisit if engine
   install cost hurts CI.
3. **Provider-specific index guidance** once a consumer reports table size and
   query profiles beyond current indexed columns.
4. **Decode error context** — richer public `RuntimeStorageDecodeError` fields
   (e.g. column/path) without leaking Prisma types.
5. **Failure semantics docs** — document read/write symmetry in
   [STORAGE.md](../STORAGE.md): static facet writes surface storage failures
   when storage is present; `ProcessStore.catchErrorAndLog(...)` is the explicit
   best-effort boundary.
6. **SQLite encode path** — align `storage/sqlite/codec.ts` `orDie` with
   `RuntimeStorageSchemaError` where encoding can fail, or document as
   layer-construction-only invariant.

## Verification

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Changesets (user approval): `.changeset/prisma-runtime-storage.md`,
`.changeset/remove-runtime-query-xor.md`.
