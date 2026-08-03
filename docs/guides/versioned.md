---
title: Versioned
description: Contiguous Schema migration chains for cross-version handoff
---

# Versioned

Cross-version payload migration for Hyperlink. Contracts are Schemas; when a tip
shape moves, keep a **contiguous chain** of transforms so older peers and durable
rows still decode. App code always speaks the **current tip**.

```ts
import * as Versioned from "hyperlink-ts/Versioned"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Schema, SchemaTransformation } from "effect"

// Prefer Schema.Class tips (identifier = schemaVersion). WorkPool.Tag payload is still
// Struct-shaped today — Struct + identifier annotation works the same for identity:
const JobV1 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
}).annotate({ identifier: "jobs/payload@1" })

const JobV2 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
}).annotate({ identifier: "jobs/payload@2" })

const toV2 = SchemaTransformation.transform({
  decode: (j: typeof JobV1.Type): typeof JobV2.Type => ({ ...j, priority: 0 }),
  encode: ({ priority: _p, ...j }: typeof JobV2.Type): typeof JobV1.Type => j,
})

const Job = Versioned.make(JobV1).migrate(JobV2, toV2)

class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job, // tip Type = JobV2; wire accepts JobV1 too
}) {}
```

## Tip identity

`Versioned.schemaVersion(schema)` → string:

1. `Schema.Class.identifier` (preferred), or AST `identifier` annotation  
2. Else AST content-hash (same family as `contractHash`)

That string is stamped on status `services[].schemaVersion`, durable rows, and
codec descriptors. One system — the old numeric `WorkPool.withSchemaVersion` is
deprecated.

## Seams (v1)

| Seam | Behavior |
|------|----------|
| WorkPool RPC payload | Spec uses `Versioned.wireSchema` — older tips upcast on decode |
| Durable reopen | Row `schemaVersion` + upcast into tip |
| Status | `schemaVersion` next to `contractHash` for WorkPool serves |
| Handoff | Peer `enqueue` rides the same wire Schema (B newer can accept A’s tip) |

Missing path → `MigrationPathMissing` (loud; not softened by Policy).

## Not this module

- Whole Spec drift → `contractHash` / F4  
- Retiring a **method** from the Handle → planned `Hyperlink.deprecated` (after this)  
- Update impact / A/B launcher → planned after Versioned

See [`docs/handoffs/versioned-schema-decisions.md`](../handoffs/versioned-schema-decisions.md).
