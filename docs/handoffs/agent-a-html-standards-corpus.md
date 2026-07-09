# Agent A — HTML standards corpus (local Claude)

**Agent:** Local Claude (**Agent A**)  
**Branch:** `action/html-standards-corpus` from **`integration/storage`**  
**Blocks:** Agent B (doc platform), Agent C (standards audit)  
**Chat rule:** Post diff stat, file list, and a one-paragraph sample of HTML structure after each major chapter — see [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Mission

Study this repo and **codify every style, layout, docs, and example rule** into a formal **HTML corpus** that:

1. **Humans** can read in a browser (future web server — same stack as `src/web` + Vite examples)
2. **Machines** can parse reliably (semantic HTML, stable IDs, metadata attributes)
3. **Raw HTML** remains skimmable (clear headings, short sections — not a minified blob)

This is the **SSOT for “how effect-pm should look”** going forward. Markdown handoffs remain for migration notes; **new normative standards live in HTML**.

Anthropic’s HTML-docs direction: prefer **structured HTML over Markdown** for agent-consumed standards because hierarchy, IDs, and `data-*` metadata survive parsing better than MD ambiguity.

---

## Read first (repo study — budget half the session)

| Source | Extract |
|--------|---------|
| [`docs/AGENTS.md`](../AGENTS.md) | Repo map, invariants, verification |
| [`AGENTS.md`](../../AGENTS.md) | Git, vendored repos, Effect platform policy |
| [`.cursor/rules/module-layout.mdc`](../../.cursor/rules/module-layout.mdc) | Effect-true module shape |
| [`.cursor/rules/public-vs-internal.mdc`](../../.cursor/rules/public-vs-internal.mdc) | Public vs `internal/`, store facets |
| [`docs/STORAGE.md`](../STORAGE.md) | Persistence rules (note: being rewritten — codify **target** golden store model from store-cutover handoffs) |
| [`docs/handoffs/store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) | Store SSOT for persistence sections |
| [`src/web/`](../src/web/) | Web UI conventions (Tailwind 4, component patterns) |
| [`examples/README.md`](../../examples/README.md) | Example forms/scenarios/shared layout |
| [`repos/effect/packages/effect/src/`](../repos/effect/) | Read-only — idiomatic Effect module shape (sample 3–5 modules: `Layer.ts`, `Cache.ts`, `RpcServer.ts`) |
| User/engineering rules | Effect LSP hygiene, naming, testing, no unsafe casts (infer from `docs/AGENTS.md` + handoffs) |

**Do not** copy stale Markdown wholesale — **verify against `src/`** where rules claim behavior.

---

## Deliverable layout

Create under **`docs/site/standards/`**:

```
docs/site/
├── README.md                 # How this tree relates to Markdown docs + future platform
└── standards/
    ├── index.html            # Corpus home — nav to all chapters
    ├── meta.html             # Defines the HTML format itself (for Agent B)
    ├── module-layout.html
    ├── public-internal.html
    ├── effect-typescript.html
    ├── storage-store.html
    ├── documentation.html    # How to write docs (incl. this HTML format)
    ├── examples.html         # forms / scenarios / shared / web examples
    ├── web-ui.html           # src/web + Vite example apps
    ├── testing.html
    ├── naming-exports.html
    └── glossary.html         # Canonical terms (Tag, facet, Store.Service, …)
```

You may add chapters if gaps exist; do not sprawl past ~12 top-level pages without supervisor review.

---

## HTML format rules (define in `meta.html` and follow everywhere)

Each standards page MUST:

| Requirement | Detail |
|-------------|--------|
| **DOCTYPE + lang** | `<!DOCTYPE html><html lang="en">` |
| **`<head>`** | `<title>`, `<meta charset="utf-8">`, `<meta name="description">`, optional `<link rel="stylesheet" href="../assets/standards.css">` (create minimal CSS) |
| **Stable IDs** | Every rule: `id="rule-<domain>-<slug>"` on `<article>` or `<section>` |
| **Machine metadata** | `data-rule-id`, `data-severity="must|should|may"`, `data-applies-to="src|docs|examples|test|all"` |
| **Human structure** | `<nav>` breadcrumb, `<main>`, `<article>`, `<h1>`–`<h3>`, `<dl>` for rule/summary pairs |
| **Code** | `<pre><code class="language-ts">` — escaped, copy-pasteable |
| **Cross-links** | `<a href="module-layout.html#rule-...">` — no broken anchors |
| **Index manifest** | `standards/manifest.json` — array of `{ id, title, href, tags[] }` for Agent B/C |

**Raw readability:** sections ≤ ~40 lines; one rule per `<article>` when possible.

**Optional:** `<script type="application/json" id="page-rules">` block per page for ultra-machine-readable export (Agent C).

---

## Session slices (one branch, complete all)

### Slice 1 — Inventory

- Branch `action/html-standards-corpus` from `integration/storage`
- Write `docs/site/README.md` + empty `standards/manifest.json` schema
- Post in chat: rule source checklist (files read, gaps found)

### Slice 2 — `meta.html` + `index.html` + `standards.css`

- Document the HTML standard itself
- Minimal readable CSS (system font, max-width, code blocks) — **no React yet**

### Slice 3 — Core engineering chapters

- `module-layout.html`, `public-internal.html`, `effect-typescript.html`, `naming-exports.html`
- Each rule: **Must** state *why* (one sentence), *example OK*, *example violation*

### Slice 4 — Domain chapters

- `storage-store.html`, `documentation.html`, `examples.html`, `web-ui.html`, `testing.html`

### Slice 5 — Glossary + manifest + ship

- `glossary.html` — terms used consistently across chapters
- Populate `manifest.json` from all `data-rule-id`s
- `pnpm run typecheck` (unchanged) — no src edits required
- Open PR → `integration/storage` (or post compare URL if local only)

---

## Out of scope (Agent B / C)

- Vite dev server, React wrappers, component library
- Rewriting existing `docs/*.md`
- Auto-fixing `src/` violations
- `repos/` edits

---

## Done when

- [ ] `docs/site/standards/` corpus with ≥10 HTML pages + manifest
- [ ] `meta.html` defines format Agent B will componentize
- [ ] Rules verified against `src/` samples cited in HTML
- [ ] Chat shows file tree + sample `data-rule-id` excerpt
- [ ] PR or compare link posted

---

## Status

- [ ] Not started
