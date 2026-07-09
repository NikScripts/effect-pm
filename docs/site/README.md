# Documentation site (`docs/site/`)

Normative **standards** for effect-pm live here as **HTML** (machine- and human-readable). Narrative and migration notes stay in `docs/*.md` until migrated.

## Pipeline (local Claude agents)

| Agent | Handoff | Delivers |
|-------|---------|----------|
| **A** | [`handoffs/agent-a-html-standards-corpus.md`](./handoffs/agent-a-html-standards-corpus.md) | `standards/*.html` + `manifest.json` |
| **B** | [`handoffs/agent-b-html-doc-platform.md`](./handoffs/agent-b-html-doc-platform.md) | Vite served platform (`docs:serve`) |
| **C** | [`handoffs/agent-c-standards-audit.md`](./handoffs/agent-c-standards-audit.md) | Audit reports + strict fix PRs |

**Web stack target:** Vite + React + Tailwind v4 — same family as `src/web/` and `examples/resource-web/`.

## Status

Agent A not started — `standards/` directory will appear on branch `action/html-standards-corpus`.
