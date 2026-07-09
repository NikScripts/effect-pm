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
| `.changeset/run-resource-handle-rpc-store.md` | Merge into platform changeset |
| (missing) Process tag / `Process.result` removal | Add |
| (missing) Queue `itemSchema` → `payload` | Add when Queue agent merges |
| (missing) Symbol `@nikscripts/effect-pm/Process/success` | Add |

**Policy:** no `@deprecated` shims — document migration snippets only.

### Migration block (platform)

```ts
// RunResource
yield* gate.run(input)           // was: yield* gate(input)
Tag()(key, payload, success)   // was: inputSchema, successSchema

// Process
Tag()(key, success, error)     // was: resultSchema, errorSchema
// remove: .pipe(Process.result(schema))

// Queue (when landed)
Tag()(key, payload)            // was: itemSchema
```

---

## Stale docs audit

Run ripgrep in `docs/`, `examples/`, `CHANGELOG.md` (not `repos/`):

```bash
rg 'inputSchema|successSchema|resultSchema|itemSchema|errorSchema|RunGate|gate\(' docs examples CHANGELOG.md .changeset
```

Known stale (fix or assign to module agent):

| File | Issue |
|------|-------|
| `docs/CODEBASE-INVENTORY.md` | ✅ RunResource Service line uses `payload` / `success` |
| `docs/handoffs/2026-07-07-rpc-schema-names-payload-success-error.md` | Mark rename **done** for RR/Process; open for Queue |
| `docs/handoffs/result-schema-and-rpc-validation.md` | Keep fingerprint design; status table |
| `CHANGELOG.md` | Unreleased note documents `Process.result` removal + store tap |
| `.changeset/process-toolkit-namespace.md` | Historical — do not duplicate |

---

## Examples README

| Example | Expected teaching |
|---------|-------------------|
| `run-resource-runtime-observer.ts` | Subscribables, not RunResourceStore |
| `process-store-events-sqlite-layer.ts` | SQLite + run facts logged |
| Queue examples | `payload` on Tag after Queue agent |

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

No fixes required; no exceptions for these two files.

### Documented exceptions (not errors)

| Location | Why left |
|----------|----------|
| `CHANGELOG.md` / `.changeset/*` | Historical release notes — grep hits expected |
| `docs/handoffs/*` (archive) | Migration narrative; link to `STORAGE.md` for current truth |
| `package.json` `store/QueueResource` export | No `src/store/queueResource.ts` — release cleanup pending |
| Engine TSDoc / internal param names `itemSchema` | Internal codec helpers; public Tag uses `payload` |

### Still open (docs-release / Agent 2)

- Consolidated platform changeset
- `PROCESS-API.md`, `guides/process.md` — Agent 2 Session 2
- `2026-07-07-rpc-schema-names-payload-success-error.md` status table — mark Queue rename done when Agent 2 merges

---

## STORAGE.md / PROCESS-API / PACKAGE-GUIDE

**Updated 2026-07-09:** `STORAGE.md` describes golden Store bridge — all four toolkits on declared `Storage`; legacy execution facets deleted. **Process** API guide owned by Agent 2.

---

## AGENTS.md

Integration branch adds pointer to integration branch + handoff — keep in sync:

```markdown
<!-- confirm integration branch name and reports/README link -->
```

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
- Removing legacy `*Store` facets from ProcessStorage
