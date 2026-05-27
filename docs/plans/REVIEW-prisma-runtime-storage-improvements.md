# Review report: `cursor/remove-xor-query-958b` → follow-ups

**Audience:** Agent continuing Prisma / storage work on effect-pm.  
**Reviewed branch:** `cursor/remove-xor-query-958b` (commits `c741f80`, `5777241`).  
**Baseline to stay aligned with:** `cursor/dashboard-wow-planning-handoff-158c` (includes this adapter merge + grill handoff docs).

---

## Required: merge alignment

Before further Prisma work, **merge `origin/cursor/dashboard-wow-planning-handoff-158c` into your working branch** (or rebase onto it) so both lines are identical for now.

```bash
git fetch origin
git checkout cursor/remove-xor-query-958b   # or your active branch
git merge origin/cursor/dashboard-wow-planning-handoff-158c
# resolve conflicts if any; then push
git push -u origin cursor/remove-xor-query-958b
```

**Why:** The dashboard handoff branch already contains a clean merge of `remove-xor-query-958b` (merge commit on handoff branch). Keeping one integration tip avoids duplicate/conflicting Prisma doc or STORAGE edits.

Do **not** merge stale `cursor/runtime-storage-sqlite-b6d7` — it is far behind `main`.

---

## What landed (summary for context)

| Area | Change |
|------|--------|
| Adapter | `PrismaRuntimeStorage` implements `RuntimeStorageService` over `effectPmRuntimeRecord` |
| Schema | `EffectPmRuntimeRecord` → `effect_pm_runtime_records`; JSON in string columns |
| API | `make`, `layer`, `layerFromContext`, `prismaClientLayer`, `layerProcessStore` |
| Removed | `PrismaProcessStore`, fail-fast placeholder, `Xor` predicate |
| Tests | Structural mock + conformance; generated Prisma SQLite integration test |
| CLI | `effect-pm prisma init`, updated `add prisma` / `prisma:print-schema` |
| Changesets | `prisma-runtime-storage.md` (minor), `remove-runtime-query-xor.md` |

---

## Improvement backlog (prioritized)

### P0 — correctness / ops

1. **`update` / `delete` scalability (read-then-N-write)**  
   - **Today:** `read(query)` loads all matches, then one Prisma `update`/`delete` per row (batched via `$transaction` when the client exposes it).  
   - **Risk:** Large match sets (facet sweeps, broad predicates) → memory + round-trip blow-up.  
   - **Ask:** Where `wherePredicate` is complete, use `updateMany` / `deleteMany` (or single SQL statement) and preserve readonly skip semantics. Keep read-then-write only for predicates that cannot compile to Prisma `where`.  
   - **Acceptance:** Conformance still passes; add one test with many rows showing bounded Prisma call count (mock spy).

2. **Driver errors vs `Effect.die`**  
   - **Today:** Most non–`P2002` failures on `read` / `upsert` / batch writes become defects (`Effect.orDie`).  
   - **Ask:** Align with STORAGE.md direction: either document Prisma as defect-only explicitly, or introduce a tagged `PrismaRuntimeStorageDriverError` mapped at the port boundary (without widening `RuntimeStorageError` until a cross-adapter decision).  
   - **Acceptance:** Documented contract + tests for connection/timeout-style failures (mock rejection).

3. **Corrupt / invalid JSON columns**  
   - **Today:** `decodeRow` / `jsonColumn` **throw** on bad DB text → defect on `read`.  
   - **Ask:** Use the same narrowing style as sqlite (`Effect` + tagged decode error) or fail the row read with a recoverable error channel.  
   - **Acceptance:** Test: row with invalid `payload_json` does not take down unrelated reads.

4. **Empty `And []` predicate**  
   - **Today:** `And` with zero predicates compiles to `{}` where → Prisma matches all rows.  
   - **Ask:** Confirm facet code never emits this; if possible, compile empty `And` to `impossibleWhere` (same as empty `Or`).  
   - **Acceptance:** Unit test on `wherePredicate`.

### P1 — DX / migration

5. **Legacy `EffectPmEvent` migration story**  
   - Schema fragment and marker are **RuntimeRecord-only**. WOW/consumers on the old model need an explicit migration note (new model + table; no shim).  
   - **Ask:** Short section in README or MIGRATION doc: “replacing EffectPmEvent” checklist (`add prisma` / `prisma init`, migrate, swap to `layerProcessStore`).

6. **CI install / Prisma engines**  
   - Generated-client test requires `prisma` CLI on PATH (`devDependency`) and may need `pnpm approve-builds` for `@prisma/engines` in restricted CI.  
   - **Ask:** Document in `docs/AGENTS.md` Cloud/CI gotchas; optionally gate generated test behind env var `EFFECT_PM_PRISMA_INTEGRATION=1` for fast default CI.

7. **Stale plan doc**  
   - `docs/plans/HANDOFF-grill-prisma-runtime-storage.md` still describes placeholder / `PrismaProcessStore` / `effectPmEvent`.  
   - **Ask:** Update to “implemented” summary + point to `PrismaRuntimeStorage` and this review file; keep grill rounds only for v2 topics (push-down updates, typed errors).

### P2 — polish

8. **`update`/`delete` service allocation**  
   - Re-enters `make(client)` inside methods; use a single closed-over `RuntimeStorageService` instance.

9. **`upsert` readonly guard**  
   - Uses `findMany({ take: 1 })` before `upsert`; acceptable; optional `findUnique` for clarity. Ensure conformance covers readonly existing row.

10. **`Between` date bounds**  
    - Prisma uses exclusive `gt`/`lt`; must stay aligned with `RuntimeStorage.memory` / conformance (add explicit test if missing).

---

## What is already strong (do not regress)

- Structural `PrismaRuntimeStorageClient` only — package does not import `@prisma/client`.
- Injected client; adapter does not call `$disconnect`.
- Predicate → Prisma `where` push-down on **read** (major step up from placeholder).
- `describeRuntimeStorageContract` on structural mock.
- Generated Prisma SQLite smoke test.
- `layerProcessStore({ client })` parity with sqlite ergonomics.
- `STORAGE.md` documents Prisma row shape and string JSON columns.

---

## Verification commands (after changes)

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

If touching public behavior: **request human approval** before editing changesets; two existing changesets cover adapter + Xor removal.

---

## Suggested agent prompt (paste to other agent)

```
You are continuing Prisma RuntimeStorage work on @nikscripts/effect-pm.

1. SYNC BRANCHES FIRST
   Merge origin/cursor/dashboard-wow-planning-handoff-158c into your branch
   (e.g. cursor/remove-xor-query-958b) so we stay identical with the integration
   tip that already merged the Prisma adapter. Push after merge.

2. READ
   - docs/plans/REVIEW-prisma-runtime-storage-improvements.md (this backlog)
   - src/prisma/PrismaRuntimeStorage.ts
   - test/prisma-runtime-storage.test.ts
   - test/runtime-storage.conformance.ts
   - docs/STORAGE.md (Prisma section)

3. IMPLEMENT (pick order)
   P0: update/delete batching where safe; driver/decode error policy; empty And guard.
   P1: migration doc; CI note for prisma integration test; refresh HANDOFF-grill-prisma doc.

4. Do not merge cursor/runtime-storage-sqlite-b6d7.
5. No commits without user approval on user-owned branches; agent branches OK per task rules.
6. Remind human to approve changesets before release (prisma-runtime-storage + remove-runtime-query-xor already present).
```
