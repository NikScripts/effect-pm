# Follow-up: queue `R` literals vs `Effect.provide` (typecheck backlog)

**Status**: backlog — `pnpm run typecheck` failures tracked here for a later pass.

## Root cause (library types)

Typed `ProcessGroup.make` declares requirements as **`TypedProcessGroupQueueRequirements<Entries>`**, i.e. **`ProcessGroupQueueEntries<Entries>["id"]`** (string literal queue ids).

`Effect.provide(layer)` narrows **`R`** with **`Exclude<R, ROut>`**, where **`ROut`** is the **layer output** (queue **service / `Self`**).

`Exclude<"demo-queue", DemoQueue>` does **not** remove the literal, so callers do not typecheck as having satisfied queue dependencies after **`provideLayer`**, including runners that **`Layer.mergeAll`** queue **`*.layer`** values.

Secondary friction (call sites): **`Effect.gen` → `return yield* inner.pipe(provideLayer(...))`** can leave redundant queue (or other) **`R`** on the **outer** generator. Flattening helps **after** (or alongside) aligning declared requirements with what **`provide`** subtracts.

**Canonical fix target**: [`src/ProcessGroup.ts`](../../src/ProcessGroup.ts) (`TypedProcessGroupQueueRequirements` and callers that duplicate that shape).

## Files currently failing typecheck

Listed as **repository-relative paths** (from `pnpm run typecheck` / `tsgo`).

### Examples — `examples/forms/process-group`

- `examples/forms/process-group/process-group-contract-http.ts`
- `examples/forms/process-group/process-group-make-entries.ts`
- `examples/forms/process-group/process-group-remote-contract-drift.ts`
- `examples/forms/process-group/process-group-remote-layer.ts`
- `examples/forms/process-group/process-group-service.ts`
- `examples/forms/process-group/process-manager-connection-registry.ts`
- `examples/forms/process-group/process-manager-endpoint-service.ts`

### Examples — `examples/scenarios`

- `examples/scenarios/full-process-group-with-queues-and-control-cli.ts`

### Tests — `test`

- `test/control-service-contract.test.ts`
- `test/process-group-typed.test.ts`
- `test/process-manager.test.ts`

## Diagnostics you will see

- **`TS377004`** / **`effect(missingEffectContext)`** — quoted queue id literals still treated as missing.
- **`TS2345`** on **`Effect.runPromise(...)`** — effect **`R`** is not **`never`** (examples / scenario).
- **`TS2322`** on **`vitest`** **`it.live`** callbacks — returned effect **`R`** is not **`Scope`**-only when the harness expects that.

## Suggested sequencing

1. Adjust **`TypedProcessGroupQueueRequirements`** (and overloads mirroring it) so required queue slots **`Exclude`** against **`QueueResource.Service` `layer`** outputs (or equivalent **`Context.Key`** / **`TagIdentifier`** typing), preserving tuple inference goals documented in **`ProcessGroup.ts`**.
2. Re-run **`pnpm run typecheck`**; then selectively flatten nested **`Effect.gen`** at the files above **only if** residuals remain.

## Release note

Resolving this will likely touch **exported public types**; add a **changeset** when shipping.
