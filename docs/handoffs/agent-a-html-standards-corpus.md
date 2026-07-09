# Agent A — HTML + Tailwind standards corpus (local Claude) — PHASE 2

**Blocked until:** Agent B merges bespoke docs app shell.  
**Decision:** [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md) Option 6.

**Writes to:** `docs/site/content/standards/*.html` — **HTML with Tailwind utility classes** (not Markdown). Agents author source in repo; owner reads on phone via `docs:serve`.

Follow `content/standards/meta.html` template. Register pages + `data-rule-id` rules in `manifest.json`.

**Branch:** `action/html-standards-corpus`

See [`local-agents.md`](./local-agents.md) § Agent A for slices. Study repo rules from `docs/AGENTS.md`, `.cursor/rules/*.mdc`, verify against `src/`.

**Owner chat:** Full HTML chapter in **After** block each slice (Before = `none — new file` for new chapters).

## Status

- [ ] Blocked on Agent B
