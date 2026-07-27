# Local agents (Claude) — prompts & protocol

**Order:** **B → A → C** · **Base:** `integration/storage`  
**Decision (locked):** [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md) — Option 6: bespoke docs app, agent HTML + Tailwind, official website path.

**Owner chat:** Before/After blocks — [`supervisor-protocol.md`](./supervisor-protocol.md).  
**Async:** [`agent-status.md`](./agent-status.md) on every push.

---

## Short prompt (Agent B — restart)

```
Read docs/handoffs/agent-b-html-doc-platform.md and docs/handoffs/docs-platform-architecture-decision.md.

You are Agent B. Do NOT write code yet.

Slice 0: have a real planning conversation with me. Read the handoff § Slice 0 — ask 3–5 questions at a time (styling, content format, phone UX, site scope, what must not be throwaway). Follow up on my answers. When we're aligned, write docs/handoffs/agent-b-plan.md and wait for my explicit approval before Slice 1.

After approval: branch action/html-doc-platform from integration/storage and execute the plan (Slices 1–5). Before/After blocks each slice.
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

**Pattern:** `examples/hyperlink-web/` tooling — **not** `<Dashboard>`.

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
