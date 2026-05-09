---
"@nikscripts/effect-pm": minor
---

Add Prisma-backed `ProcessStore` and the `effect-pm` admin CLI.

- New `@nikscripts/effect-pm/prisma` subpath export with `PrismaProcessStore.make` /
  `.layer` / `.layerFromContext`. Uses a single envelope-shaped `EffectPmEvent`
  table so adding new event types in the future never requires a schema
  migration. The adapter never imports `@prisma/client` directly — it relies on
  a structural `PrismaProcessStoreClient` that any generated client satisfies.
- `@prisma/client` is declared as an optional peer dependency.
- New `effect-pm` bin with two commands:
  - `effect-pm prisma:print-schema` — print the canonical Prisma schema
    fragment to stdout.
  - `effect-pm add prisma [--separate-file|--no-separate-file] [--dry-run]`
    — detect single-file or multi-file Prisma schema layouts and add the
    `EffectPmEvent` model idempotently.
- Codec exposes `encodeEvent`, `decodeEventRow`, and a tagged
  `PrismaProcessStoreDecodeError` for malformed rows. No unsafe casts at the
  Prisma JSON boundary; decoding uses narrowing predicates.
- README + examples updated to describe `ProcessStore.layer` for development
  and `PrismaProcessStore.layer({ client })` for production. Removed the
  legacy `examples/prisma-storage.ts`.
