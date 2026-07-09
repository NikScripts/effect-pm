# Agent B — HTML doc platform (local Claude)

**Status:** **BLOCKED** until Agent A merges `docs/site/standards/` corpus.  
**Agent:** Local Claude (**Agent B**)  
**Branch:** `action/html-doc-platform` from **`integration/storage`**

---

## Mission

Turn Agent A’s static HTML standards into a **served documentation platform** using the **same technology family** as the product web UI:

- **Vite 6** (see `examples/resource-web/vite.config.ts`)
- **React 19** + **Tailwind CSS v4** (see `src/web/`, `@tailwindcss/vite`)
- Eventually share tokens/components with `src/web` where sensible

Human-readable via `pnpm run docs:serve`. Machine-readable via unchanged `manifest.json` + HTML module fragments.

---

## Prereqs

- [`agent-a-html-standards-corpus.md`](./agent-a-html-standards-corpus.md) merged
- Read `meta.html` — Agent A defines include/slot conventions Agent B must implement

---

## Planned slices (detail when unblocked)

1. Scaffold `docs/site/app/` — Vite SPA, `docs:serve` / `docs:build` scripts
2. HTML module loader — fetch/inline `standards/*.html` fragments or compile to React
3. Layout shell — nav from `manifest.json`, breadcrumb, search stub
4. Style alignment — `src/web/theme.css` tokens or subset
5. Static export — `dist/` servable without RPC backends (unlike `resource-web`)

---

## Status

- [ ] Blocked on Agent A
