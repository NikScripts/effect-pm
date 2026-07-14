# Agent 1 — Session 2: Storage docs platform sweep

**Branch:** `cursor/store-platform-docs-a009` from **`integration/storage`** (one branch, one PR)  
**Agent:** Store cutover owner (Agent 1) — long session, **5 slices**, do not stop between slices  
**Supervisor merges** when green; you keep working on the same branch until all slices done.

**Docs bus (async):** Update [`agent-status.md`](./agent-status.md) on every push.

**Owner chat (mandatory):** Paste **all work** each slice — full doc sections, full code, full test output. **No diff file lists.** See [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Read first

| Doc | Why |
|-----|-----|
| [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | Golden model — declared `Storage`, tiers, no facets on engine path |
| [`store-cutover-queue.md`](./store-cutover-queue.md) | Queue engine store shipped |
| [`store-cutover-process.md`](./store-cutover-process.md) | Process store shipped |
| [`store-cutover-runresource.md`](./store-cutover-runresource.md) | RunResource store shipped |
| [`reports/2026-07-07-agent-report-store.md`](../reports/2026-07-07-agent-report-store.md) | Rewrite target — mostly stale |
| [`reports/2026-07-07-agent-report-docs-release.md`](../reports/2026-07-07-agent-report-docs-release.md) | Grep policy |

**Do not edit:** `src/Process.ts`, `processStoreSpec.ts`, Process agent report (Agent 2 owns Process code/docs).

---

## Locked (code is shipped — docs must match)

- Engine paths: `materializeEngineQueueStore*`, `builtIn*StoreContract`, `Store.layerDefaultMemory` on toolkit layers
- **`QueueResourceStore` / `ProcessExecutionStore` / `RunResourceStore` facets deleted** from engine paths (`src/`); Log/Lifecycle facets may remain
- Config-object-only `Tag` wire on all four toolkits
- QR write-buffer off hot path = **future** — mention, do not implement

---

## Session slices (complete all on one branch)

### Slice 1 — Baseline + inventory

```bash
git checkout integration/storage && git pull
git checkout -b cursor/store-platform-docs-a009
pnpm run typecheck && pnpm test
```

Read `docs/STORAGE.md` end-to-end. List every paragraph that contradicts shipped code (facets on engine path, `serviceOption` reads, `itemSchema`, etc.). Keep a scratch list for slices 2–3.

### Slice 2 — Rewrite `docs/STORAGE.md`

Full pass — not a patch. Structure:

1. **Golden model** — `Store.Service`, `Tag.store(tag)`, `Storage` declared dependency, `layerDefaultMemory`
2. **What facets remain** — Log, ProcessLifecycle (if still accurate); what was **removed** from engine paths
3. **Per-toolkit store** — Queue/CQR/Process/RunResource one subsection each; link store-cutover handoffs
4. **Usage example** — app `Store.Service` + `Process.store` / queue registration (copy from `examples/forms/process-store/` if needed)
5. **Wire events** — queue persists `QueueEvent<T>` union via store bridge; drop `queue.entry.*` facet tables if engine no longer writes them (verify in `src/` before deleting claims)

Verify claims against `src/QueueResource.ts`, `src/Store.ts`, `src/store/*` — **no guessing**.

### Slice 3 — Agent reports + integration-sync

- Rewrite [`reports/2026-07-07-agent-report-store.md`](../reports/2026-07-07-agent-report-store.md): Stage 1 **done**, engine wired for all four toolkits, cast status per module, open = write-buffer + owner TODOs only
- Update [`integration-sync-2026-07-07.md`](integration-sync-2026-07-07.md) Store + Queue + RunResource tables — remove `processStoreTap`, “Queue facet only”, “Stage 1 blocked”
- Update [`reports/2026-07-07-agent-report-queue-resource.md`](../reports/2026-07-07-agent-report-queue-resource.md) priority → **Done** if nothing open except write-buffer future

### Slice 4 — Cross-doc grep sweep

```bash
rg 'itemSchema|inputSchema|resultSchema|errorSchema|QueueResourceStore\.record|ProcessExecutionStore|processStoreTap|serviceOption\(QueueResourceStore' docs/ examples/ CHANGELOG.md .changeset --glob '!repos/**'
```

Fix hits in: `docs/guides/store.md`, `docs/guides/history-and-persistence.md`, `docs/RESOURCE-API.md`, `docs/PACKAGE-GUIDE.md`, `docs/CODEBASE-INVENTORY.md`, `examples/**/README.md`.

**Skip** files Agent 2 owns unless clearly wrong and non-Process: `PROCESS-API.md`, `guides/process.md`.

Append sweep results to docs-release agent report (new “2026-07-09 Agent 1 sweep” section).

### Slice 5 — Ship

```bash
pnpm run typecheck && pnpm test && pnpm run lint
```

Commit per slice or one commit — your choice. Push branch. Open draft PR → `integration/storage`. Mark this handoff complete.

---

## Done when

- [x] `STORAGE.md` describes golden store model (no engine facet dual-write)
- [x] Store + integration-sync reports match `integration/storage` code
- [x] Grep sweep clean in scoped paths (or documented exceptions in docs-release report)
- [x] PR open → `integration/storage` — see PR link in session chat / compare URL
