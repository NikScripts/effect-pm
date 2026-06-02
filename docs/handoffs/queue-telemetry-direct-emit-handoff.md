# Queue worker direct telemetry handoff

## Branch and working tree

```text
cursor/integration-jun-2026
```

Suggested topic branch if splitting a PR:

```text
cursor/telemetry-direct-emit
```

## Current status

**Implemented locally, not yet committed** (as of handoff write).

| File | Change |
|------|--------|
| `src/QueueResource.ts` | Worker path uses scoped `QueueResourceStore.*` emitters directly |
| `docs/STORAGE.md` | Worker row points at direct `Entry.*` |
| `docs/recipes/queue-resource-telemetry-migration.md` | Cleanup status updated |

Public **`emit*`** helpers in `src/store/queueResource.ts` are **unchanged** — apps and tests keep using them.

## Goal (completed in this slice)

Per `docs/recipes/queue-telemetry-index-batch.md` §5: stop building intermediate fact envelopes inside the queue worker; call schema-backed telemetry under the correct scopes.

**Before:** `buildEntryFact` → `emitEntryFact(fact)` (and same pattern for lifecycle, dedupe, rate limit).

**After:** `writeEntryEvent` / `writeLifecycleEvent` / `writeDedupeKeyChange` / `writeRateLimitExceeded` → `QueueResourceStore.Entry.*`, `.Lifecycle.*`, `.DedupeKey.*`, `.RateLimit.Exceeded`.

## Architecture (two emit surfaces)

| Caller | API | When |
|--------|-----|------|
| Apps, tests, external code | `emitEntryFact`, `emitLifecycleChange`, `emitDedupeKeyChange`, `emitRateLimitExceededFact` (+ batch `*Facts` / `*Changes`) | `src/store/queueResource.ts` |
| `QueueResource` worker internals | `writeEntryEvent`, `writeLifecycleEvent`, `writeDedupeKeyChange`, `writeRateLimitExceeded` | Inside `makeQueue` closure in `src/QueueResource.ts` (~1534–1985) |

Both paths materialize the same wire types and indexes; the worker path skips the fact-shaped intermediate types.

### Scope wiring

| Event family | Scopes |
|--------------|--------|
| Entry (`Entry.Enqueued`, `.Started`, …) | `QueueResourceScope.run({ queueId })` → `QueueEntryScope.run({ entryId })` |
| Lifecycle | `QueueResourceScope.run({ queueId })` only |
| Dedupe key | `QueueResourceScope.run({ queueId })` → `QueueDedupeKeyScope.run({ key })` |
| Rate limit exceeded | `QueueResourceScope.run({ queueId })` → `QueueEntryScope.run({ entryId })` |

Scope types: `src/QueueResourceScope.ts`. Telemetry schemas: `src/store/queueResourceTelemetry.ts`.

### ID generation (unchanged semantics)

Worker keeps monotonic seq counters per queue instance:

- `nextEntryFactId(entryId, statusSegment)`
- `nextLifecycleId(tag)`
- `nextDedupeChangeId(kind)` — `"added"` / `"released"`
- `nextRateLimitExceededId(entryId)`

IDs remain human-readable strings like `` `${queueName}/${entryId}/started/3` `` — not spine auto-ids.

### Best-effort writes

`recordStoreWrite(label, effect)` wraps telemetry with `ProcessStore.catchErrorAndLog` (warning + annotations `queueId`, `label`).

**Important:** Events with `Telemetry.logWarning` on the schema use `applySchemaWarnings`, which **logs storage errors without re-failing** the Effect. Duplicate-key / storage failures may therefore **not** reach `catchErrorAndLog` when `logWarning` is attached on the emitter. Tests document this; mocks are used where strict failure is required.

## Dedupe batch: do not use `.batch` for multi-key

`key` on dedupe events is **scope-backed** (`QueueDedupeKeyScope`), not a free input field on batch rows. `DedupeKey.Added.batch` under a single `QueueDedupeKeyScope` would repeat one key for every row.

**Current worker behavior** (`recordDedupeKeyChanges`):

```ts
Effect.forEach(keys, (key) => writeDedupeKeyChange(kind, key, changedAtMs), { discard: true })
```

Same effective behavior as the old `emitDedupeKeyChanges` (`Effect.forEach` per change). A future batch API would need per-input scope materialization in the telemetry factory — not available today.

## Attributes on entry events

`recordEntryEvent` / `recordEntryEventForQueueEntry` still accept `attributes` in options for API stability, but **telemetry schemas do not include `attributes`** — they are not written. This matches the prior `emitEntryFact` path (facts could carry attributes in TS types but storage payload did not).

## Key symbols to grep

```text
writeEntryEvent
writeLifecycleEvent
writeDedupeKeyChange
writeRateLimitExceeded
recordStoreWrite
recordEntryEvent
recordLifecycleEvent
recordDedupeKeyChanges
emitRateLimitExceeded   # hook + store write (name unchanged)
```

Store facet (public): `QueueResourceStore` from `@nikscripts/effect-pm/store/QueueResource` / `src/store/queueResource.ts`.

## Tests

Focused:

```bash
pnpm exec vitest run \
  test/queue-resource.test.ts \
  test/queue-resource-emit.test.ts \
  test/queue-resource-store-facet.test.ts
```

Full (integration line):

```bash
pnpm install
pnpm test          # expect 358 passed; Prisma skipped if CLI missing
pnpm run build
```

Emit parity and facet conformance live in `test/queue-resource-emit.test.ts` and `test/queue-resource-store-facet.test.ts`.

## Verification already run (this slice)

- `pnpm test` — 358 passed
- Queue-focused suite — 86 passed
- No new linter issues on `src/QueueResource.ts`

## Optional follow-up (not in this slice)

1. **`Entry.Enqueued.batch`** (and other entry `.batch`) on hot enqueue paths for fewer spine round-trips — see `docs/recipes/queue-telemetry-index-batch.md` §3–4.
2. **Fold** `docs/recipes/queue-resource-telemetry-migration.md` into `docs/STORAGE.md` when the team no longer needs the migration narrative.
3. **Changeset** before release — extend `.changeset/queue-resource-emit-helpers.md` or add a patch note for worker direct emit (user often forgets changesets).

## Commit / PR checklist

```bash
git status
git diff src/QueueResource.ts

# Suggested commit message theme:
# refactor(queue): emit worker telemetry via scoped QueueResourceStore

# After commit, merge topic branch into integration or open PR to integration.
```

Do **not** commit unless the user explicitly asks.

## Related docs

| Doc | Use when |
|-----|----------|
| [integration-jun-2026-handoff.md](./integration-jun-2026-handoff.md) | Parent integration branch, worktrees, other parallel slices |
| [facet-telemetry-158c-handoff.md](./facet-telemetry-158c-handoff.md) | Telemetry factory, `.batch` generation, codecs |
| [../recipes/queue-telemetry-index-batch.md](../recipes/queue-telemetry-index-batch.md) | Index-on-event design; target worker call shape |
| [../recipes/queue-resource-telemetry-migration.md](../recipes/queue-resource-telemetry-migration.md) | Migration Q&A and cleanup status |
| [../STORAGE.md](../STORAGE.md) | Authoritative storage / facet reference |
| [../AGENTS.md](../AGENTS.md) | Package invariants and verification commands |

## Agent starter prompt

Copy-paste for a fresh agent:

```text
You are continuing queue telemetry work on @nikscripts/effect-pm.

Read first:
- docs/handoffs/queue-telemetry-direct-emit-handoff.md
- docs/handoffs/integration-jun-2026-handoff.md (branch + worktree)
- docs/AGENTS.md

Context: QueueResource.ts worker already calls QueueResourceStore.Entry.* /
Lifecycle.* / DedupeKey.* / RateLimit.Exceeded directly (scoped). Public emit*
helpers in src/store/queueResource.ts remain for apps/tests.

Branch: cursor/integration-jun-2026 (uncommitted changes may exist — check git status).

If asked to commit: only when user explicitly requests; remind about changeset.

Task: <fill in — e.g. commit + PR, Entry.Enqueued.batch on enqueue path, or next integration slice>
```
