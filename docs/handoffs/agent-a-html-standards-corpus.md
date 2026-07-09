# Agent A — HTML standards corpus (local Claude) — **PHASE 2**

**Order:** **After Agent B** — content goes into the **served** `docs/site/` tree. Refresh on phone via `pnpm run docs:serve`.  
**Agent:** Local Claude (**Agent A**)  
**Branch:** `action/html-standards-corpus` from **`integration/storage`** (must include B's `docs:serve` + nav)  
**Blocks:** Agent C (standards audit)

**Docs bus (async):** Update [`agent-status.md`](./agent-status.md) on every push.

**Owner chat (mandatory):** After each chapter, post **Before / After** (before = `(none — new file)` for new HTML). Full chapter in After block. Template in [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Prereq

- Agent B merged: `pnpm run docs:serve` binds `host: true`, nav loads `standards/manifest.json`
- Read `docs/site/standards/meta.html` (B's format template) — **follow it exactly**

---

## Mission

Study the repo and codify **every style, layout, docs, and example rule** into `docs/site/standards/*.html`:

1. Readable on your phone via Tailscale while you edit
2. Machine-parseable (`data-rule-id`, `manifest.json`)
3. Skimmable as raw HTML in the repo

Markdown handoffs stay for migration notes; **normative standards live in served HTML**.

---

## Read first (repo study)

| Source | Extract |
|--------|---------|
| [`docs/AGENTS.md`](../AGENTS.md) | Repo map, invariants |
| [`.cursor/rules/module-layout.mdc`](../../.cursor/rules/module-layout.mdc) | Effect-true modules |
| [`.cursor/rules/public-vs-internal.mdc`](../../.cursor/rules/public-vs-internal.mdc) | Public vs internal |
| [`docs/STORAGE.md`](../STORAGE.md) + [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | Persistence golden model |
| [`examples/README.md`](../../examples/README.md) | Example layout |
| `src/web/`, `repos/effect/packages/effect/src/` (samples) | UI + idiomatic Effect |

Verify rules against `src/` — do not copy stale Markdown blindly.

---

## Deliverable chapters

Create under **`docs/site/standards/`** (register each in `manifest.json`):

| File | Topic |
|------|--------|
| `module-layout.html` | PascalCase modules, flat exports, internal split |
| `public-internal.html` | Public vs `src/internal/`, store facets |
| `effect-typescript.html` | Effect LSP hygiene, no raw Node, TaggedError |
| `naming-exports.html` | Tags, subpaths, barrel |
| `storage-store.html` | Store bridge, tiers, no engine facet dual-write |
| `documentation.html` | How to write docs (this HTML format) |
| `examples.html` | forms / scenarios / shared |
| `web-ui.html` | `src/web`, Vite examples |
| `testing.html` | Vitest, test-d.ts |
| `glossary.html` | Canonical terms |

Update `standards/index.html` nav via manifest only (per B's convention).

---

## Session slices (one branch — do not stop early)

### Slice 1 — Inventory + serve check

- Branch from `integration/storage` with B's platform
- `pnpm run docs:serve` — confirm phone can open `/standards/index.html`
- Post chat: sources read, chapter outline

### Slice 2 — Core chapters (3–4 HTML files)

`module-layout`, `public-internal`, `effect-typescript`, `naming-exports` — each rule in `<article data-rule-id="…">`

### Slice 3 — Domain chapters (4–5 HTML files)

`storage-store`, `documentation`, `examples`, `web-ui`, `testing`

### Slice 4 — Glossary + manifest

- Populate `manifest.json` `rules[]` from every `data-rule-id`
- `glossary.html`

### Slice 5 — Ship

- Spot-check all pages on phone
- PR → `integration/storage`
- Post chat: rule count, manifest excerpt, diff stat

---

## Out of scope

- Changing Vite platform structure (file B if broken)
- `src/` edits, `repos/` edits
- Full Markdown migration

---

## Status

- [ ] Blocked until Agent B ships `docs:serve` + `meta.html` template
