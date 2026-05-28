# Handoff: `cursor/prisma-storage-followup-958b` — merge & critical review

**Audience:** Agent (or human) working on / merging the storage follow-up branch.  
**Reviewer context:** Review performed after merging this branch into `cursor/dashboard-control-slice-1-158c` (2026-05-27).  
**Branch tip:** `9ad245e` (`origin/cursor/prisma-storage-followup-958b`)  
**Base (`main`):** `aacf8b8`

---

## Executive summary

| Verdict | Detail |
|--------|--------|
| **Merge to `main`** | **Recommended** — focused, tested, documents a real breaking behavior change intentionally. |
| **Scope** | **Not** new Prisma adapter work; that already landed on `main`. This branch is **write-failure semantics** + call-site wiring + docs/tests + small SQLite codec/service hardening. |
| **Risk** | **Breaking** for any consumer that relied on implicit swallow of facet static-emitter failures. Package internals are updated; **app code outside this repo must be audited**. |
| **Blockers before release** | Fix **stale TSDoc** in `src/store/queueResource.ts` (still describes removed builder `catchCause` behavior). Consider **splitting changeset** breaking notes from Prisma adapter notes. |

---

## Branch inventory (do not confuse)

| Remote branch | vs `main` | Status |
|---------------|-----------|--------|
| `origin/cursor/remove-xor-query-958b` | **0 commits ahead** | Already on `main` via `2525c3e` (export merge). Nothing to merge. |
| `origin/cursor/prisma-storage-followup-958b` | **3 commits ahead** | **This handoff.** Force-pushed at some point (`1cbacd0…9ad245e`); verify no external work based on old tip. |

### Commits on this branch (only these three above `main`)

1. `0fc238d` — Make ProcessStore write failure handling explicit  
2. `94983c4` — Make ProcessStore emit failure handling explicit  
3. `9ad245e` — Document explicit storage write failure handling  

**Diff size:** 29 files, ~+378 / −135 lines (vs `aacf8b8`).

---

## What changed (behavioral)

### Before (implicit, in builder)

Static facet emitters (`ProcessStoreX.recordY(...)`) were wrapped inside the facet builder with **`catchCause` + `logWarning`**, so storage write failures **did not propagate** into process/queue/run work.

### After (explicit, at call sites)

1. **Builder no longer swallows** write failures on static emitters.  
2. **Public API:** `ProcessStore.catchErrorAndLog(options)` — pipeable helper in `src/internal/store/helpers.ts`, re-exported from `ProcessStore`.  
3. **Telemetry call sites** pipe emits through `catchErrorAndLog` where failure must not affect domain success:
   - `Process.ts`, `ProcessGroup.ts`
   - `QueueResource.ts`, `RunResource.ts`
   - `internal/manager/logPersistRelay.ts`, `logHistory.ts`, `groupChild.ts`
4. **Docs:** `docs/STORAGE.md` — **Storage failure semantics** table (authoritative).

### Contract table (from `docs/STORAGE.md`)

| Surface | Storage present + failure | Storage absent |
|---------|---------------------------|----------------|
| `RuntimeStorageService` | Fails with `RuntimeStorageError` | N/A |
| Facet instance reads/writes | Typed storage/facet errors | N/A |
| **Static facet emitters** | **Fail with typed errors** | **No-op success** |
| `ProcessStore.catchErrorAndLog(...)` | Logs + **succeeds (`void`)** | Succeeds |

**Guidance:** Use static emitters **directly** when failure should fail the caller. Pipe **`catchErrorAndLog`** when the write is observability-only.

---

## Files touched (by area)

| Area | Paths | Notes |
|------|-------|-------|
| **Public API** | `src/ProcessStore.ts`, `src/index.ts` | Exports `catchErrorAndLog` + options type |
| **Plumbing** | `src/internal/store/helpers.ts`, `service.ts` | Helper + builder emit statics no longer swallow |
| **Domain wiring** | `Process.ts`, `ProcessGroup.ts`, `QueueResource.ts`, `RunResource.ts` | Explicit pipes at telemetry writes |
| **Manager** | `logPersistRelay.ts`, `logHistory.ts`, `groupChild.ts` | Same pattern |
| **SQLite** | `storage/sqlite/codec.ts`, `index.ts`, `service.ts` | Encode/decode hardening (same branch) |
| **Runtime** | `RuntimeStorage.ts` | Minor surface/docs |
| **Store facets** | `store/queueResource.ts`, `store/runResource.ts` | Doc/comments only in facet files (see stale doc bug) |
| **Tests** | `test/process-store-*-facet.test.ts`, `run-resource.test.ts` | Failure propagation + `catchErrorAndLog` isolation |
| **Docs** | `STORAGE.md`, `PROCESS-API.md`, `CODEBASE-INVENTORY.md`, `plans/11-storage-prisma-follow-up.md` | |
| **Changeset** | `.changeset/prisma-runtime-storage.md` | **Appended** breaking emitter + `layerProcessStoreOrDie` notes |

---

## Critical findings (action required)

### 1. Stale module documentation — **fix before merge/release**

**File:** `src/store/queueResource.ts` (module doc, ~lines 28–30)

Still says:

> The builder wraps every static emitter with `catchCause + Effect.logWarning` so storage failures never propagate into queue work.

**That is false after this branch.** Queue writes use explicit `ProcessStore.catchErrorAndLog` in `QueueResource.ts` (see `grep catchErrorAndLog QueueResource`).

**Action:** Update module TSDoc to match `RunResource.ts` / `STORAGE.md`. Grep repo for other `catchCause` + builder references:

```bash
rg "catchCause.*logWarning|builder wraps" src/
```

### 2. Breaking change — consumer audit

**Changeset** (`.changeset/prisma-runtime-storage.md`) states:

> **Breaking:** static ProcessStore facet emitters now surface write failures when a storage layer is present.

**Action for downstream apps:**

- Grep for `ProcessStore*.record` / static emitters used inside `Effect.gen` without `.pipe(ProcessStore.catchErrorAndLog(...))`.
- Add `catchErrorAndLog` anywhere telemetry must not fail the business effect.
- Do **not** assume the old implicit swallow still exists.

### 3. Read vs write asymmetry (documented, not fixed)

- **Writes (telemetry):** failures swallowed only with `catchErrorAndLog`.  
- **Reads** (`yield* ProcessStoreX...`): operational errors still propagate from durable adapters.

Dashboard/analytics code must handle **read** failures separately. Not a regression — but more visible now that writes are explicit.

### 4. Log level inconsistency (minor)

| Call site | `catchErrorAndLog` level |
|-----------|--------------------------|
| `RunResource`, `QueueResource` telemetry | `warning` |
| `Process`, `ProcessGroup` lifecycle emits | default `error` |

**Action:** Either document intentional split in `STORAGE.md` or normalize levels.

### 5. Changeset bundling

`prisma-runtime-storage.md` mixes:

- Prisma adapter (already conceptually shipped)
- **New breaking:** static emitters
- **New breaking:** `layerProcessStore` typed acquisition vs `layerProcessStoreOrDie`

**Action:** At release, consider a **second changeset** (e.g. `process-store-explicit-write-errors.md`) so changelog readers see the emitter break separately.

### 6. `catchErrorAndLog` returns `void` only

Callers cannot recover the inner success value. Correct for emits; document if exporting examples.

### 7. Silent no-op when layer absent (unchanged)

Static emitters still succeed with no storage layer — easy to misconfigure (forgot `ProcessStorage.layer`) and get **empty analytics** with no error. Out of scope for this branch; note for future DX.

---

## What looks good (keep)

- **`catchErrorAndLog` implementation** — structured annotations from storage error shape (`_tag`, `adapter`, `operation`, `id`, `detail`, `cause`); handles both `Effect.catch` and `Effect.catchCause`.
- **Tests** — e.g. `test/process-store-run-resource-facet.test.ts`: failing facet + `Effect.flip(write)` proves error surfaces; same write piped through `catchErrorAndLog` proves log + success channel preserved.
- **`docs/STORAGE.md` failure table** — should remain the single source of truth; shrink `plans/11-storage-prisma-follow-up.md` when items land.
- **Spine unchanged philosophically** — still maps `RuntimeStorageError` → `ProcessStoreWriteError`; reads still expose `RuntimeStorageOperationalError` on `s.read`.

---

## Verification commands (run on branch tip)

```bash
git fetch origin cursor/prisma-storage-followup-958b
git checkout cursor/prisma-storage-followup-958b   # or merge into your PR branch

pnpm install
pnpm run typecheck
pnpm test    # expect 298 passed (as of review)
pnpm run build
pnpm run lint
```

**Merged integration check:** This branch was merged cleanly into `cursor/dashboard-control-slice-1-158c` at `478e468` with the same test count green.

---

## Recommended merge order

```text
main (aacf8b8)
  └── merge cursor/prisma-storage-followup-958b  ← storage semantics + doc fix
        └── merge cursor/dashboard-control-slice-1-158c  ← React control slice (optional parallel)
```

Do **not** rely on `cursor/remove-xor-query-958b` — it adds nothing beyond `main`.

---

## Checklist for the storage-branch agent

- [ ] Fix `src/store/queueResource.ts` module doc (and any other stale `catchCause` builder claims).
- [ ] Confirm `.changeset/prisma-runtime-storage.md` breaking section matches final behavior.
- [ ] Run verification commands above on `9ad245e`.
- [ ] Open PR to `main` (draft OK) with summary pointing at `docs/STORAGE.md` failure semantics.
- [ ] After merge: offer to delete remote `cursor/remove-xor-query-958b` (obsolete); **ask user** before deleting `prisma-storage-followup` remote.
- [ ] Remind releaser: **changeset approval** required; consider second changeset for emitter break.

---

## Reference: key symbol locations

| Symbol | Location |
|--------|----------|
| `ProcessStore.catchErrorAndLog` | `src/ProcessStore.ts` → `internal/store/helpers.ts` |
| Static emitter builder | `src/internal/store/service.ts` (`buildEmitStatics` — no swallow) |
| Failure semantics doc | `docs/STORAGE.md` § "Storage failure semantics" |
| Follow-up plan (future only) | `docs/plans/11-storage-prisma-follow-up.md` |
| Example test pattern | `test/process-store-run-resource-facet.test.ts` (~156–167) |

---

## Questions for product owner (if agent is blocked)

1. Should all telemetry `catchErrorAndLog` use **`warning`** uniformly?  
2. Merge storage to **`main`** before dashboard React PR, or single combined PR?  
3. Split changeset at release — yes/no?

---

*End of handoff. Copy this file path when briefing another agent: `docs/handoffs/prisma-storage-followup-958b-review.md`*
