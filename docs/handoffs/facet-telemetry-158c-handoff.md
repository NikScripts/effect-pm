# Facet telemetry branch — golden reference (tree DSL)

> **Jun 2026:** Golden **schemas/wires** only. Factory API →
> [telemetry-requirements.md](../recipes/telemetry-requirements.md) +
> [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md).
>
> ```sh
> git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts
> ```

Branch: `cursor/facet-telemetry-158c`

## Current status

This branch is pushed and green locally through:

```text
1adb34a refactor: apply decode helpers to queue store
```

The branch is stable from a test/build perspective, but it is **not a small
merge**. It changes public telemetry helpers, public storage facet types, and
wire/decode behavior. Merge only if you are ready to accept the breaking
telemetry/facet cleanup in one batch.

## What landed

- `Telemetry.events(...)`
- `Telemetry.Type.Wire<T>`
- `Telemetry.Type.Event<T, Tag>`
- `Telemetry.Type.Codec<T>`
- `Telemetry.Type.CodecTag<T, Tag>`
- `Telemetry.codec(definition)(handlers)`
- `Telemetry.index(...)`
- generated `.batch(inputs)` on input-shaped schema emitters
- named telemetry definitions for:
  - `RunResourceStore`
  - `ProcessExecutionStore`
  - `ProcessLifecycleStore`
  - `ProcessGroupStore`
- codec-backed runtime record routing for:
  - `RunResourceStore`
  - `ProcessExecutionStore`
  - `ProcessLifecycleStore`
- `RunResourceStore` public fact/state-change types derived from
  `RunResourceCodec`
- shared internal decode helpers in `src/internal/store/decode.ts`
- `RunResourceStore` and `QueueResourceStore` decoder/projection cleanup with
  `Option`/pipe-style helpers
- `docs/recipes/queue-telemetry-index-batch.md`
- `.changeset/telemetry-wire-metadata.md`

## Removed / intentionally not preserved

- old lowercase RunResource decode support:
  - `run-resource.fact.recorded`
  - `run-resource.state.changed`
  - lowercase run/state reason aliases
- stale `ProcessLifecycleRecordInput` export
- stale compatibility marker in `QueueResource.ts`

This follows the current branch rule: delete replaced APIs instead of
deprecating or shimming.

## Verification already run

Latest full verification after the queue decode helper pass:

```text
pnpm exec vitest run test/queue-resource-store-facet.test.ts
pnpm run typecheck
git diff --check
pnpm test
pnpm run lint
pnpm run build
```

Results:

- queue store focused suite passed
- typecheck passed
- full suite passed: 38 files / 318 tests
- lint passed
- build passed, including DTS output
- `tsup` still prints existing non-fatal unused external import warnings

## Merge guidance

### Stable to merge?

Technically yes: tests, lint, typecheck, and build pass.

### Should it merge to `main` right now?

Only if you want the whole telemetry consolidation to land together. The diff is
large and public:

- public `Telemetry` helper surface changed
- public RunResource projection types changed to codec-derived aliases
- legacy lowercase RunResource reads were deleted
- `ProcessLifecycleRecordInput` was removed
- changeset is included

If you want a smaller review/merge, keep this branch open and split or continue
from it.

## Recommended next branch / slice

Continue in a separate branch if you want to keep `main` safer while migrating
Queue writes.

Recommended next branch:

```text
cursor/queue-telemetry-migration-d791
```

Recommended next slice:

1. Add/confirm queue scopes.
2. Define `QueueResourceTelemetry`.
3. Add `Telemetry.index(...)` to queue events.
4. Add `QueueResourceCodec`.
5. Derive queue wire/type arrays from telemetry.
6. Keep old `record*` call sites until store reads are stable.
7. In the following slice, migrate `QueueResource.ts` call sites to direct
   telemetry emits and delete flat `record*` APIs.

Recipe:

```text
docs/recipes/queue-telemetry-index-batch.md
```

## Local checkout commands

```text
git fetch origin cursor/facet-telemetry-158c
git checkout cursor/facet-telemetry-158c
git pull origin cursor/facet-telemetry-158c
```

## Suggested local validation

```text
pnpm install
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```
