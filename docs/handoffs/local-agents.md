# Local agents (Claude) — prompts & protocol

**Order:** **B → A → C** · **Base:** `integration/storage`  
**Decision (locked):** [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md) — Option 6: bespoke docs app, agent HTML + Tailwind, official website path.

**Owner chat:** Before/After blocks — [`supervisor-protocol.md`](./supervisor-protocol.md).  
**Async:** [`agent-status.md`](./agent-status.md) on every push.

---

## Short prompt (Agent B — restart)

```
Read docs/handoffs/local-agents.md § Agent B and docs/handoffs/docs-platform-architecture-decision.md.

You are Agent B. Branch action/html-doc-platform from integration/storage.

Build the bespoke docs app shell (Vite + React + Tailwind + theme.css) — NOT Dashboard, NOT plain HTML scaffold. Agent pages live as HTML+Tailwind under docs/site/content/. Tailscale read on phone via pnpm run docs:serve.

Complete all 5 slices in agent-b-html-doc-platform.md. Before/After blocks each slice.
```

---

## Agent B — bespoke docs app shell

**Handoff:** [`agent-b-html-doc-platform.md`](./agent-b-html-doc-platform.md)

| Slice | Deliverable |
|-------|-------------|
| 1 | `docs/site/app/` React + Tailwind + theme; Tailscale serve |
| 2 | Shell loads `content/**/*.html` |
| 3 | `manifest.json` nav + `content/standards/meta.html` template |
| 4 | `docs:build` / `docs:preview` |
| 5 | README handoff to Agent A; Hydration hook note; PR |

**Pattern:** `examples/resource-web/` tooling — **not** `<Dashboard>`.

---

## Agent A — standards corpus (after B)

**Handoff:** [`agent-a-html-standards-corpus.md`](./agent-a-html-standards-corpus.md)  
**Writes:** `docs/site/content/standards/*.html` — **HTML with Tailwind classes**, `data-rule-id`, `manifest.json`.

---

## Agent C — audit (after A)

**Handoff:** [`agent-c-standards-audit.md`](./agent-c-standards-audit.md)

---

## Chat template

See [`supervisor-protocol.md`](./supervisor-protocol.md) — Before / After / Verify; no `git diff`.

---

## Branches

| Agent | Branch |
|-------|--------|
| B | `action/html-doc-platform` |
| A | `action/html-standards-corpus` |
| C | `action/standards-audit` |
