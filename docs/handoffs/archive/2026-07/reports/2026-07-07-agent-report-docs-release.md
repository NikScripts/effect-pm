# Agent report: Docs + release

**Agent:** Docs / release owner (runs **after** module agents land or in parallel on doc-only paths)  
**Priority:** Medium — required before beta cut.

---

## Scope

Cross-cutting documentation and release hygiene — **not** module implementation.

---

## Changesets (required before release)

Consolidate into **one coherent beta breaking note** (or two max: platform rename + RunResource handle):

| Existing | Action |
|----------|--------|
| ~~`.changeset/run-resource-handle-rpc-store.md`~~ | ✅ merged into `platform-store-tag-wire-beta.md` |
| ~~`.changeset/process-tag-store-cutover.md`~~ | ✅ merged into `platform-store-tag-wire-beta.md` |
| ~~Platform consolidated changeset~~ | ✅ **`.changeset/platform-store-tag-wire-beta.md`** (2026-07-10) |

**Policy:** no `@deprecated` shims — document migration snippets only.

| Action | Owner approval? | Agent duty |
|--------|-----------------|------------|
| Create / edit `.changeset/*.md` | **No** | Paste **full file** in owner chat after create (supervisor Before/After) |
| `pnpm run version` / publish | **Yes** | Propose; owner runs or approves |

SSOT: [`docs/AGENTS.md`](../../AGENTS.md#changeset-policy).

### Migration block (platform)

Slot renames — **positional and config-object both stay valid** (CQR always uses a config object
for lane options):

```ts
// RunResource
yield* gate.run(input)           // was: yield* gate(input)
Tag()(key, payload, success)     // was: Tag()(key, inputSchema, successSchema)
Tag()(key, { payload, success }) // object form — same rename

// Process
Tag()(key, success, error?)      // was: Tag()(key, resultSchema, errorSchema?)
Tag()(key, { success, error? })
// remove: .pipe(Process.result(schema))

// Queue (both valid)
Tag()(key, JobSchema)              // positional payload
Tag()(key, { payload: JobSchema }) // object payload
```

---

## Stale docs audit

```bash
rg 'inputSchema|successSchema|resultSchema|itemSchema|errorSchema|RunGate|gate\(' docs examples CHANGELOG.md .changeset
```

| File | Status |
|------|--------|
| `docs/CODEBASE-INVENTORY.md` | ✅ Store bridge + subpaths (no `store/QueueResource`) |
| ~~`docs/handoffs/2026-07-07-rpc-schema-names-payload-success-error.md`~~ | ✅ Queue/CQR rename **done**; handoff **deleted** (complete) |
| `docs/handoffs/result-schema-and-rpc-validation.md` | Keep fingerprint design; status table |
| `CHANGELOG.md` | Historical — unreleased note may need refresh at release |
| `.changeset/process-toolkit-namespace.md` | Historical — do not duplicate |

---

## Examples README

| Example | Expected teaching |
|---------|-------------------|
| `run-resource-runtime-observer.ts` | Subscribables, not RunResourceStore |
| `process-store-events-sqlite-layer.ts` | SQLite + run facts logged |
| Queue examples | ✅ `payload` on Tag |

---

## 2026-07-09 Agent 1 sweep (`cursor/store-platform-docs-a009`)

**Scope:** `docs/STORAGE.md` full rewrite + grep fixes in scoped consumer docs (not handoffs archive, not `PROCESS-API.md` / `guides/process.md` — Agent 2).

### Fixed

| File | Change |
|------|--------|
| `docs/STORAGE.md` | Golden Store bridge model; removed engine facet dual-write |
| `docs/guides/queue-resource.md` | `itemSchema` → tag `payload`; config-object Tag examples |
| `docs/guides/history-and-persistence.md` | Durability section uses tag `payload` |
| `docs/guides/toolkit-by-example.md` | Removed `itemSchema` from `serve` example |
| `docs/RESOURCE-API.md` | Replaced `QueueResourceStore` facet query with `Store.Service` / `Tag.store` |
| `docs/CODEBASE-INVENTORY.md` | Store bridge write/read; tag `payload` |
| `docs/handoffs/store-cutover-00-store-core.md` | Queue facet deletion marked fixed |

### Clean in scoped guides

`docs/guides/store.md`, `docs/PACKAGE-GUIDE.md`, `examples/**` — no grep hits for sweep pattern.

**Re-verified post-rebase (`origin/integration/storage`, 2026-07-09):**

```bash
rg 'itemSchema|QueueResourceStore|ProcessExecutionStore' docs/guides/store.md docs/PACKAGE-GUIDE.md
# (no matches)
```

---

## 2026-07-10 Agent 1 Session 3 (`cursor/store-release-hygiene-a009`)

### Closed (Agent 1 owned)

| Item | Status |
|------|--------|
| `package.json` + `tsup` stale `store/QueueResource` export | ✅ **Removed** — facet file deleted; use `QueueResource.store(tag)` |
| `AGENTS.md` + `docs/AGENTS.md` integration pointer | ✅ Points to `integration/storage` + `handoffs/reports/README.md` |
| `2026-07-07-rpc-schema-names-payload-success-error.md` Queue status | ✅ Done; handoff **deleted** (complete) |
| `store.md` / `PACKAGE-GUIDE.md` grep | ✅ Clean (re-verified) |
| `.cursor/rules/module-layout.mdc` + `docs/plans/15-runtime-storage-hybrid.md` | ✅ Removed stale `store/QueueResource` facet claim |

### Lint (`pnpm run lint`)

| Scope | Status |
|-------|--------|
| `test/**/*.test-d.ts` | ✅ ESLint override — type-level assertion files |
| `src/internal/store/*` empty-object / unused-var | ✅ eslint-disable / `_` prefix (Session 3 follow-up) |
| **`pnpm run lint`** | ✅ **green** (branch tip) |

### Still open (not Agent 1 / needs owner)

| Item | Owner |
|------|-------|
| Consolidated platform changeset | ✅ created — **`pnpm run version`** needs owner approval |
| `PROCESS-API.md`, `guides/process.md` | Agent 2 |
| RPC fingerprint / buildId | deferred (`result-schema-and-rpc-validation.md` §4) |

---

## STORAGE.md / PROCESS-API / PACKAGE-GUIDE

**Updated 2026-07-09:** `STORAGE.md` describes golden Store bridge — all four toolkits on declared `Storage`; legacy execution facets deleted. **Process** API guide owned by Agent 2.

---

## Verification

Doc-only PRs still require:

```bash
pnpm run typecheck
pnpm test
```

No release without full green.

---

## Out of scope

- RPC fingerprint / buildId (`result-schema-and-rpc-validation.md` §4)
- Running `pnpm run version` or publish without owner approval
