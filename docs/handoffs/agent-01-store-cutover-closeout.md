# Agent 01 — Store cutover close-out

**Integration branch:** `integration/storage` (base for this agent — **branch off it**, do not wait on other agents)  
**Supervisor:** cloud agent supervisor (tracks scope; you paste the Cursor branch name when the run starts)  
**Agent type:** **Cursor Cloud Agent** — one long session, multiple slices, single PR back to `integration/storage`  
**Completed branch:** `cursor/store-cutover-closeout-ce05` (`61b9963`)

---

## Read first (10 min)

| Doc | Why |
|-----|-----|
| [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | Declared `Storage`, no `serviceOption`, tier model |
| [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) | CQR store + config-object tag |
| [`store-cutover-queue.md`](./store-cutover-queue.md) | QR engine store (note: write-buffer items are **future**, not this session) |
| [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) | Wire slot names — **config object only** |

---

## Already on `integration/storage` (do not redo)

Merged before you start:

- Golden store model: `Store.extend` tiers, `Resource.builtResource`, `Store.provideContext`
- Process event tags (`Started` / `Completed` / …), RunResource `fact.append`
- **Queue + CustomQueue** engine store wiring (`materializeEngineQueueStore*`, `layerDefaultMemory`)
- **Config-object-only `Tag`** on QueueResource, Process, RunResource, CustomQueueResource
- CQR optional `success` / `error` on tag config (stamped + store wire from tag)
- Tests: queue/CQR persist, store writer assignability, tag wire schemas

Verify baseline:

```bash
pnpm run typecheck
pnpm test
```

---

## Locked decisions (do not re-litigate)

| Topic | Choice |
|-------|--------|
| Tag wire | **Config object only** — no positional schemas (`Tag(key, { payload, success?, error?, … })`) |
| CQR wire | Optional `success` / `error` on config — same stamps as QR |
| Event model | One `QueueEvent<T>` for QR + CQR; lane on entry, not a separate union |
| Store tiers | Tier 1 lean base → Tier 2 engine narrow writes → Tier 3 `*.store(tag)` analytics |
| Layers | `layer` / `serve` / `serveRemote` merge `Store.layerDefaultMemory` |
| Store core | **Out of scope** — no edits to `src/Store.ts` spine unless a test proves a bug |

---

## Goal

Close the **store cutover consumption path** on `integration/storage`: golden parity where cheap, handoffs match code, branch is merge-ready toward `main`.

**Not in scope:** logs platform (`Resource.logs`, kill `captureLogs` / `HistoryStore` forks), QR write-path buffer off hot path, changeset without owner approval.

---

## Slices (one session, in order)

### A — Verify baseline

- Branch from `integration/storage`
- `pnpm run typecheck` + `pnpm test` — fix regressions only if you introduced them

### B — CQR `BuiltResource` parity

Mirror `QueueResource` / `Process`:

- `Resource.builtResource` + `grantLocal` in CustomQueue `layer` / `serve` / `serveRemote`
- Drop per-method `provideR` where `builtResource` covers worker `R | RR`
- Typecheck + mirror test pattern from `test/process-built-resource.test-d.ts` if needed

**Files:** `src/CustomQueueResource.ts`, possibly `src/Resource.ts` (only if shared helper gap)

### C — Handoff truth sweep

Update checkboxes / stale bullets so docs describe **shipped** code:

- `store-cutover-customqueue.md`, `store-cutover-queue.md`
- Strike aspirational `storeTap` / unchecked items already done (materialize path, `layerDefaultMemory`)
- Mark **future** explicitly: write-buffer off hot path (`store-cutover-queue.md` §2–3)

**No behavior change** — docs only in this slice.

### D — Integration sync stub

Add a short “2026-07-09 integration/storage” note at top of [`integration-sync-2026-07-07.md`](./integration-sync-2026-07-07.md) OR a one-line pointer file — what landed on `integration/storage` since the July 7 sync (config-object tags, CQR store, golden pass). Keep it under 30 lines.

### E — Ship

- Commit, push your `cursor/*` branch
- Open **draft PR → `integration/storage`** (not `main` unless supervisor says otherwise)
- PR description: slices completed, verification commands, explicit out-of-scope list

---

## Optional stretch (only if A–E are green)

- RunResource persist `Interrupted` facts (if engine path is one-file obvious)
- `Failed.cause` vs `error` naming alignment doc note (no wide rename without owner)

---

## Anti-patterns (supervisor will flag)

- Starting logs consistency / `live`→`stream` rename
- Editing `src/Store.ts` / `internal/store/spine.ts` for features
- Re-introducing positional `Tag` overloads
- Waiting for another agent’s PR
- Scope creep into `examples/resource-web` (excluded from root typecheck — pre-existing TS2589)

---

## Branch naming

Create: `cursor/store-cutover-closeout-a009` (or similar) **from `integration/storage`**.

Paste the branch name to the supervisor when the run exists.

---

## Done when

### Phase 1 (slices A–E)

- [x] CQR uses `builtResource` on toolkit layers (or documented blocker in PR)
- [x] Handoffs match shipped store/tag behavior
- [x] `pnpm run typecheck` + `pnpm test` green
- [ ] Draft PR targeting `integration/storage` — branch pushed; open via [compare link](https://github.com/NikScripts/effect-pm/compare/integration/storage...cursor/store-cutover-closeout-ce05?expand=1) if auto-create blocked

### Phase 2 (docs truth sweep + ship)

- [x] Integration-sync stale rows fixed (`integration-sync-2026-07-07.md`)
- [x] Queue agent report refreshed (`reports/2026-07-07-agent-report-queue-resource.md`)
- [x] Queue handoff checkboxes match `integration/storage` code (`store-cutover-queue.md`)
- [x] PR body updated with Phase 2 summary; verification commands recorded
