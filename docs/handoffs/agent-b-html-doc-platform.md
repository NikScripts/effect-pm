# Agent B — Bespoke docs app shell (local Claude)

**Status:** **UNBLOCKED** — Option 6 locked in [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md)  
**Branch:** `action/html-doc-platform` from **`integration/storage`**

**Docs bus:** [`agent-status.md`](./agent-status.md) on every push.  
**Owner chat:** Before/After blocks per [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Mission

Build the **official package website shell** — a bespoke docs application, not throwaway static HTML and **not** `<Dashboard>`.

| Near term | Long term |
|-----------|-----------|
| Vite + React + Tailwind v4 + `src/web/theme.css` tokens | Effect `Hydration` / `HydrationBoundary` (not Next) — hook only, no impl now |
| Agent pages = **HTML files with Tailwind** under `content/` | Same app grows into full public site |
| `pnpm run docs:serve` — Tailscale **read** on phone | |

**Pattern:** `examples/resource-web/` (Vite, `host: true`, React entry) — **not** its Dashboard import.

---

## Target layout

```
docs/site/
├── app/
│   ├── main.tsx
│   ├── DocsApp.tsx          # layout, nav, mobile-readable
│   ├── loadContent.ts       # fetch/import content/*.html
│   └── styles.css           # @import theme + Tailwind @source
├── content/
│   ├── standards/           # Agent A writes here
│   │   ├── meta.html        # format template
│   │   └── manifest.json
│   └── …
├── vite.config.ts           # host: true, port 5190
└── README.md
```

Migrate or replace the old root `index.html` / minimal `site.css` scaffold — do not preserve throwaway structure for its own sake.

---

## Slices (one branch, complete all)

### 1 — Vite React app + Tailscale serve

- `docs/site/app/` like `resource-web`: React, `@tailwindcss/vite`, import `../../src/web/theme.css` (or documented `@source` path per `docs/guides/setup.md` §2b)
- `pnpm run docs:serve` → `0.0.0.0:5190`
- README: Tailscale **read** URL for phone

### 2 — Load agent HTML pages

- Shell renders `content/**/*.html` (fetch at dev, build copies to dist)
- Mobile-readable typography (reuse theme tokens)

### 3 — Nav from `content/standards/manifest.json`

- Add `content/standards/meta.html` — template for Agent A (`data-rule-id`, Tailwind classes on `<article>`)

### 4 — `docs:build` + `docs:preview`

- Production build includes all content HTML; preview uses `host: true`

### 5 — Handoff + ship

- README: “Agent A: add a chapter” (HTML + Tailwind + manifest entry)
- Comment in `DocsApp.tsx` or README: future `HydrationBoundary` seam — no implementation
- `agent-status.md`; PR → `integration/storage`

---

## Out of scope

- Full standards corpus (Agent A)
- `<Dashboard>` / ops widgets
- Foldkit (optional owner demo — not this agent)
- Next.js
- `src/` package edits unless required for theme import path

---

## Done when

- [ ] Bespoke app serves on Tailscale phone (read)
- [ ] Agent HTML pages render with Tailwind + theme
- [ ] `meta.html` + manifest nav
- [ ] `docs:build` / `docs:preview` green

## Status

- [ ] Not started
