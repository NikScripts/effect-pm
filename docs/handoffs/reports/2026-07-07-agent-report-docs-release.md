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
| `docs/CODEBASE-INVENTORY.md` | RunResource Service line may still say `inputSchema` |
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

## STORAGE.md / PROCESS-API / PACKAGE-GUIDE

Until Process engine tap lands:

- State clearly: **RunResource** auto-writes to Store + legacy facet; **Process** legacy facet only for engine; **Queue** legacy facet only.
- Link module reports in `docs/handoffs/reports/README.md`.

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
