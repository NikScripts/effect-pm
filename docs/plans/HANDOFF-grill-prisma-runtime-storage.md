# Handoff: Prisma `RuntimeStorage` adapter

**Status:** Implemented on `cursor/remove-xor-query-958b` and aligned with
`cursor/dashboard-wow-planning-handoff-158c`.

This file is no longer a grill prompt for v1. It records what shipped and where
future agents should continue.

---

## Implemented v1

| Area | Result |
|------|--------|
| Adapter | `PrismaRuntimeStorage` implements `RuntimeStorageService`. |
| Import | Prefer `@nikscripts/effect-pm/storage/prisma`. |
| Client | Apps inject a generated Prisma client; effect-pm never imports `@prisma/client`. |
| Delegate | Structural client expects `client.effectPmRuntimeRecord`. |
| Schema | `EffectPmRuntimeRecord` maps to table `effect_pm_runtime_records`. |
| JSON storage | Runtime JSON blobs serialize to string columns (`*_json`) to avoid Prisma JSON null sentinel coupling. |
| Layers | `make`, `layer`, `layerFromContext`, `prismaClientLayer`, and `layerProcessStore`. |
| Lifecycle | App owns Prisma construction and `$disconnect`. |
| Errors | Duplicate id and readonly writes remain logical typed errors; driver/decode failures map to public operational `RuntimeStorageError` tags. |
| Tests | Shared conformance, structural mock tests, and generated Prisma SQLite client integration. |

Primary files:

- [`src/prisma/PrismaRuntimeStorage.ts`](../../src/prisma/PrismaRuntimeStorage.ts)
- [`src/prisma/types.ts`](../../src/prisma/types.ts)
- [`src/prisma/schema.ts`](../../src/prisma/schema.ts)
- [`test/prisma-runtime-storage.test.ts`](../../test/prisma-runtime-storage.test.ts)
- [`test/prisma-runtime-storage.generated-client.test.ts`](../../test/prisma-runtime-storage.generated-client.test.ts)
- [`docs/STORAGE.md`](../STORAGE.md)

---

## Consumer setup

```sh
pnpx @nikscripts/effect-pm prisma init
pnpm prisma migrate dev --name add_effect_pm_runtime_records
pnpm prisma generate
```

```ts
import { PrismaRuntimeStorage } from "@nikscripts/effect-pm/storage/prisma";

const layer = PrismaRuntimeStorage.layerProcessStore({ client: prisma });
```

Consumers migrating from an event-table model should add the new model and move
reads to per-domain facets; there is no event-table compatibility layer.

---

## Remaining v2 topics

Use [`REVIEW-prisma-runtime-storage-improvements.md`](./REVIEW-prisma-runtime-storage-improvements.md)
as the active backlog. Current open questions:

1. Whether Prisma should support provider-specific SQL for even larger bulk
   mutation/query paths beyond `count` / `updateMany` / `deleteMany`.
2. Whether generated-client integration tests should remain in default `pnpm
   test` or become opt-in if CI engine installation becomes too costly.

---

## Verification

Run:

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Before release, confirm the existing changesets:

- `.changeset/prisma-runtime-storage.md`
- `.changeset/remove-runtime-query-xor.md`
