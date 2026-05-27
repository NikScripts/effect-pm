---
"@nikscripts/effect-pm": minor
---

Ship `PrismaRuntimeStorage` as a Prisma-backed `RuntimeStorage` adapter over normalized runtime records.

The Prisma schema fragment now declares `EffectPmRuntimeRecord` mapped to the `effect_pm_runtime_records` table, with indexed columns stored as scalar fields and runtime JSON blobs serialized into string columns. The adapter expects an injected structural client with an `effectPmRuntimeRecord` delegate. Consumers continue to own Prisma generation, migrations, and client lifecycle.

Add `effect-pm prisma init` for interactively adding the schema fragment to an existing Prisma project, and verify the adapter with both structural mocks and a generated Prisma SQLite client.

Add typed `RuntimeStorage` operational errors for durable adapters, mapping Prisma / SQLite driver and decode failures into public storage error tags instead of defects.

**Breaking:** static ProcessStore facet emitters now surface write failures when a storage layer is present. They still no-op when the facet layer is absent. Use the new pipeable `ProcessStore.catchErrorAndLog(...)` helper for writes that should remain best-effort telemetry.

**Breaking:** SQLite `layerProcessStore` now surfaces typed acquisition errors. Use `layerProcessStoreOrDie` to keep the previous defect-on-acquisition behavior at application edges.
