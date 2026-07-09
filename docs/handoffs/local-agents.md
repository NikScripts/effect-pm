# Local agents (Claude) — prompts & protocol

**Order:** **B → A → C** · **Integration base:** `integration/storage`  
**Owner chat format:** [`supervisor-protocol.md`](./supervisor-protocol.md) — **Before / After** fenced blocks, never `git diff`.

Update [`agent-status.md`](./agent-status.md) on every push (async). Paste **all work** in owner chat each slice.

---

## Chat template (every slice)

```markdown
### Slice N — [title]

**Before** (`path/to/file` or `none — new file`):

```language
…prior content…
```

**After**:

```language
…full new content…
```

**Verify**:

```text
…verbatim terminal output…
```
```

**Forbidden:** `git diff`, `git diff --stat`, filename-only bullets.

---

## Agent B — PHASE 1: doc server (start here)

**Handoff:** [`agent-b-html-doc-platform.md`](./agent-b-html-doc-platform.md)  
**Branch:** `action/html-doc-platform`

### Mission

Turn `docs/site/` scaffold into a **Tailscale-friendly** doc server (`pnpm run docs:serve`, `host: true`, port `5190`). Agent A writes HTML into `standards/` after B ships nav + `meta.html` template.

**Scaffold on integration line:** `docs/site/vite.config.ts`, `index.html`, `standards/index.html`, `pnpm run docs:serve`.

### Slices (complete all on one branch)

| Slice | Work | Chat: Before/After |
|-------|------|-------------------|
| **1** | `pnpm run docs:serve`; confirm `0.0.0.0:5190`; document Tailscale URL in `docs/site/README.md` | README Tailscale section |
| **2** | Nav from `standards/manifest.json` on `index.html` + `standards/index.html`; add `standards/meta.html` template | Full HTML/JS files |
| **3** | Document HTML module convention in `meta.html` + README (static `standards/*.html` preferred) | meta + README sections |
| **4** | Fix `docs:build` / `docs:preview` so `standards/*.html` in dist; `host: true` on preview | config + Verify output |
| **5** | README “Agent A: add a chapter”; optional `site.css` ↔ `src/web/theme.css` subset; `agent-status.md`; PR | README section |

### Out of scope

Full standards corpus (Agent A), `src/` edits, rewriting `docs/*.md`.

### Done when

- [ ] Phone opens `http://<tailscale-ip>:5190/` while editing
- [ ] Nav driven by `manifest.json`
- [ ] `meta.html` template for Agent A
- [ ] `docs:build` + `docs:preview` green
- [ ] Every slice posted in owner chat as Before/After blocks

---

## Agent A — PHASE 2: standards HTML corpus

**Handoff:** [`agent-a-html-standards-corpus.md`](./agent-a-html-standards-corpus.md)  
**Branch:** `action/html-standards-corpus`  
**Blocked until:** Agent B merged.

### Mission

Codify repo rules into `docs/site/standards/*.html` — readable on phone via `docs:serve`, machine-parseable via `data-rule-id` + `manifest.json`.

### Read first

`docs/AGENTS.md`, `.cursor/rules/module-layout.mdc`, `.cursor/rules/public-vs-internal.mdc`, `docs/STORAGE.md`, `store-cutover-00-store-core.md`, `examples/README.md`, sample `src/` + `repos/effect/` modules. **Verify against `src/`.**

### Chapters

`module-layout.html`, `public-internal.html`, `effect-typescript.html`, `naming-exports.html`, `storage-store.html`, `documentation.html`, `examples.html`, `web-ui.html`, `testing.html`, `glossary.html` — register in `manifest.json`.

### Slices

1. Inventory + serve check — outline in chat  
2. Core chapters (4 files) — **After** = full HTML each  
3. Domain chapters (5 files) — **After** = full HTML each  
4. `glossary.html` + populate `manifest.json` `rules[]`  
5. Phone spot-check; `agent-status.md`; PR  

### Out of scope

Vite platform changes (Agent B), `src/` / `repos/` edits.

---

## Agent C — PHASE 3: strict audit

**Handoff:** [`agent-c-standards-audit.md`](./agent-c-standards-audit.md)  
**Branch:** `action/standards-audit`  
**Blocked until:** Agent A merged.

### Mission

Scan `src/`, `test/`, `examples/`, `docs/` against `standards/manifest.json`. **Stricter than owner.** Publish `docs/site/audits/YYYY-MM-DD-report.html`. PR with **top 5** fixes only.

### Chat per finding

```markdown
### Finding — [rule-id]

**Before** (`path:line`):

```ts
…violating code…
```

**After** (proposed):

```ts
…fixed code…
```
```

### Slices

1. Manifest → heuristic map (markdown table in chat)  
2. Scan; catalog violations (Before/After each)  
3. HTML audit report  
4. Top 5 fixes (Before/After each)  
5. PR + `agent-status.md`  

---

## Branch naming

| Agent | Branch |
|-------|--------|
| B | `action/html-doc-platform` |
| A | `action/html-standards-corpus` |
| C | `action/standards-audit` |
