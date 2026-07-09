# Agent 2 — Session 2: Process platform finish

**Branch:** `cursor/process-platform-a009` from **`integration/storage`** (one branch, one PR)  
**Agent:** Process owner (Agent 2) — long session, **5 slices**, continue on same branch through all slices  
**Session 1 merged:** cast-free `builtInProcessStoreContract`, agent report, `process.md` / `PROCESS-API` touch-up.

**Docs bus (async):** Update [`agent-status.md`](./agent-status.md) on every push.

**Owner chat (mandatory):** Paste **all work** each slice — full doc sections, full code, full test output. **No diff file lists.** See [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Read first

| Doc | Why |
|-----|-----|
| [`store-cutover-process.md`](./store-cutover-process.md) | Shipped behavior |
| [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | §5 error/success encoding |
| [`process-store-cutover-review.md`](./process-store-cutover-review.md) | Update stale review notes |
| [`integration-sync-2026-07-07.md`](./integration-sync-2026-07-07.md) | Process row + cross-cutting #2 |
| [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) | RPC slot policy |

**Reference:** `src/Process.ts` `recordStoreFailed`, `src/internal/processEvent.ts`, RunResource fact encoding if mirroring.

---

## Locked

- Config-object-only `Process.Tag`
- No Store spine edits unless test proves bug
- No logs platform
- No changeset without owner approval
- If RPC `error` wire needs shared infrastructure changes → document blocker in report, do not half-ship

---

## Session slices (complete all on one branch)

### Slice 1 — Baseline

```bash
git checkout integration/storage && git pull
git checkout -b cursor/process-platform-a009
pnpm run typecheck && pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/process-toolkit.test.ts
```

### Slice 2 — Store `Failed.error` fidelity audit + tests

Store path already uses `errorOf(tag)` in `recordStoreFailed` (`Process.ts`). Verify:

1. Read engine path: failure → `store.record({ _tag: "Failed", error: … })` uses typed error when tag declares `error`, else `String(...)` per store-core §5
2. Add or extend tests in `test/process-store-engine.test.ts` / sqlite persist test: tag with struct `error` schema round-trips through default memory store
3. If gap found, fix in `Process.ts` / `processEvent.ts` only — not `Store.ts`

### Slice 3 — RPC `error` slot (stretch — complete investigation)

Trace `errorOf(tag)` from Tag stamp → RPC spec build → worker `Failed` wire payload.

- If **local** to `Process.ts` / `internal/processRpc*.ts`: wire typed `error` on RPC failure responses matching store encoding
- If requires shared RPC fingerprint / buildId → **skip implementation**; add “RPC error wire blocked on …” to agent report with file:line pointers

Add `test/process-contract-shape.test-d.ts` or RPC test if wire changes.

### Slice 4 — Examples + review docs

| Path | Action |
|------|--------|
| `examples/forms/process-store/**` | Ensure examples use `Process.layer`, `Process.store`, config-object Tag; fix stale imports/comments |
| `docs/handoffs/process-store-cutover-review.md` | Add “Review 2026-07-09” — tap deleted, cast-free contract, journal codec on integration line; strike obsolete serialization warnings if store-core fix landed |
| `docs/STORAGE.md` | **Only** Process execution history subsection if still wrong after Agent 1 (coordinate: if Agent 1 runs in parallel, touch Process paragraphs only) |
| `integration-sync-2026-07-07.md` | Process table: cast ✅, open = RPC error only if slice 3 blocked |

### Slice 5 — Ship

```bash
pnpm run typecheck && pnpm test
```

Update [`reports/2026-07-07-agent-report-process.md`](./reports/2026-07-07-agent-report-process.md) with Session 2 outcomes. Push. Draft PR → `integration/storage`. Mark this handoff complete.

---

## Done when

- [ ] `Failed.error` store path tested (typed + fallback)
- [ ] RPC `error` wired or blocker documented with owner decision ask
- [ ] Examples + review doc current
- [ ] PR open → `integration/storage`
