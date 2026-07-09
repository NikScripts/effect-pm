# Documentation site (`docs/site/`)

**Official package website** (in progress) — bespoke docs app + agent-written HTML/Tailwind content.

**Decision:** [`handoffs/docs-platform-architecture-decision.md`](./handoffs/docs-platform-architecture-decision.md)

## Read on phone (Tailscale)

```bash
pnpm run docs:serve
# http://<tailscale-ip>:5190/
```

Read-only on phone; agents edit HTML in repo on the server.

## Architecture (target)

| Part | Tech |
|------|------|
| Shell | Vite + React + Tailwind v4 + `src/web/theme.css` tokens |
| Content | `content/**/*.html` with Tailwind — written by agents |
| Ops dashboard | Separate — `@nikscripts/effect-pm/web` / `resource-web` |
| Future RSC | Effect `Hydration` + `HydrationBoundary` — not Next |

## Agents

| Phase | Doc |
|-------|-----|
| B | [`handoffs/agent-b-html-doc-platform.md`](./handoffs/agent-b-html-doc-platform.md) |
| A | [`handoffs/agent-a-html-standards-corpus.md`](./handoffs/agent-a-html-standards-corpus.md) |
| C | [`handoffs/agent-c-standards-audit.md`](./handoffs/agent-c-standards-audit.md) |

Prompts: [`handoffs/local-agents.md`](./handoffs/local-agents.md)
