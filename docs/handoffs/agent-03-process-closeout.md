# Agent 03 — Process close-out

**Integration branch:** `integration/storage` (**branch off it** — independent of Agent 01 / branch cleanup)  
**Supervisor:** cloud agent supervisor  
**Agent type:** **Cursor Cloud Agent** (same Process agent session if still open — you already have context)  
**Prior work:** `cursor/process-store-cutover-a3ad` merged; golden store pattern landed on `integration/storage`.

---

## Read first (15 min)

| Doc | Why |
|-----|-----|
| [`store-cutover-process.md`](./store-cutover-process.md) | Authoritative — what's done |
| [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | §5 — `Failed.error` / `Completed.success` encoding |
| [`integration-sync-2026-07-07.md`](./integration-sync-2026-07-07.md) | Stale lines to fix in agent report |
| [`reports/2026-07-07-agent-report-process.md`](./reports/2026-07-07-agent-report-process.md) | Refresh target |

**Reference implementations (cast-free contracts):**

- `src/internal/store/queueStoreSpec.ts` — `builtInQueueStoreContract`
- `src/internal/store/runResourceStoreSpec.ts` — `builtInRunResourceStoreContract`

---

## Already on `integration/storage` (do not redo)

- `ProcessExecutionStore` facet deleted; engine uses `store.record` via `builtInProcessStoreContract`
- `processStoreTap.ts` deleted — wiring in `Process.ts` / `buildProcessImpl`
- Event tags: `Started` / `Completed` / `Failed` / `Interrupted` (no `Run*` prefix)
- `Resource.builtResource` + `grantLocal` on `layer` / `serve` / `serveRemote`
- `layerDefaultMemory` merged on toolkit layers
- Config-object-only `Process.Tag(key, { success?, error?, … })`
- Tests: `test/process-store-*.test.ts`, `test/process-built-resource.test-d.ts`

Verify baseline:

```bash
pnpm run typecheck
pnpm test
```

---

## Locked decisions (do not re-litigate)

| Topic | Choice |
|-------|--------|
| Tag wire | Config object only — no positional schemas |
| Store tiers | Tier 1 `builtInProcessStoreContract` → Tier 2 `Process.store(tag)` analytics |
| `Process.make` | No auto store writes — document, do not change behavior |
| Store spine | **Out of scope** — no edits to `src/Store.ts` unless a test proves a bug |
| Logs platform | **Out of scope** — `Resource.logs`, `captureLogs`, `HistoryStore` |
| Changeset | **Out of scope** without owner approval |

---

## Goal

Close remaining **Process module** debt on `integration/storage`: drop the last store-contract cast, refresh stale docs/reports, and leave a truthful handoff for docs-release.

---

## Slices (one session, in order)

### A — Verify baseline

- Branch from `integration/storage`
- `pnpm run typecheck` + `pnpm test`

### B — Cast removal on `builtInProcessStoreContract`

**Problem:** `src/internal/store/processStoreSpec.ts` still has:

```ts
makeProcessStoreBaseContract(successOf(tag), errorOf(tag)) as ProcessStoreBaseContract<Tag>
```

Queue and RunResource `builtIn*StoreContract` helpers are cast-free.

**Approach (mirror RunResource):**

1. Ensure `makeProcessStoreBaseContract` infers a return type assignable to `ProcessStoreBaseContract<Tag>` without `as`.
2. Pattern: generic factory + tag wrapper returning the inferred contract (see `makeRunResourceStoreContract` + `builtInRunResourceStoreContract`).
3. If TypeScript cannot prove assignability, narrow with **typed helpers** (`SchemaDecoded`, shape handles) — **no** `as any` / `as unknown as`.

**Files:** `src/internal/store/processStoreSpec.ts` (primary), tests if assignability regresses.

**Add** `test/process-store-contract.test-d.ts` assertion if public `record` input typing changes.

### C — Stale report + handoff truth sweep

Update [`reports/2026-07-07-agent-report-process.md`](./reports/2026-07-07-agent-report-process.md):

- Remove references to `processStoreTap.ts`, `ProcessExecutionStore`, `RunCompleted` / `RunFailed` symbol names
- Mark cast removal done (slice B)
- Update branch/target to `integration/storage`
- Open items: only what remains after this session (or "none")

Touch if still wrong:

- [`docs/guides/process.md`](../../docs/guides/process.md) — layer vs `make`, store path
- [`docs/PROCESS-API.md`](../../docs/PROCESS-API.md) — persistence / store section
- [`docs/STORAGE.md`](../../docs/STORAGE.md) — Process store facet retirement

Do **not** duplicate `store-cutover-process.md`; link to it.

### D — Optional stretch (only if straightforward)

**RPC `error` slot:** integration-sync notes tag `error` is stamped but unused on RPC paths. If you find a **small, local** wire in `Process.ts` / RPC spec build (no Store spine changes), wire `errorOf(tag)` into typed `Failed` payloads. If it touches shared RPC infrastructure or needs owner decision, **skip** and leave a one-line note in the agent report.

### E — Verify + PR

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/process-toolkit.test.ts
```

Single PR → `integration/storage`. Mark this handoff done at the bottom.

---

## Out of scope

- Queue / CustomQueue / RunResource engine work
- `src/Store.ts` journal codec changes
- Branch cleanup (Agent 02)
- Agent 01 CQR `BuiltResource` (`cursor/store-cutover-closeout-ce05`) — merge separately

---

## Deliverable

PR → `integration/storage` with cast-free contract (or documented blocker), refreshed Process agent report, and doc fixes.

**Branch naming:** `cursor/process-closeout-a009` (paste branch name to supervisor when the run starts).

---

## Status

- [ ] Baseline green
- [ ] Cast removed (or blocker documented in report)
- [ ] Agent report + docs refreshed
- [ ] PR open → `integration/storage`
