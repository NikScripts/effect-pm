# Agent B — Bespoke docs app shell (local Claude)

**Status:** **UNBLOCKED** — Option 6 locked in [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md)  
**Branch:** `action/html-doc-platform` from **`integration/storage`** (tip `b55c3d9`)  
**Resume:** Owner has not started B yet — old `docs/site/` scaffold exists; replace per slices below.

**Docs bus:** [`agent-status.md`](./agent-status.md) on every push.  
**Owner chat:** Before/After blocks per [`supervisor-protocol.md`](./supervisor-protocol.md).

**Critical:** **Slice 0 is a conversation, not code.** Do not branch, scaffold, or delete the old site until the owner approves a written plan.

---

## Mission

Build the **official package website shell** — a bespoke docs application, not throwaway static HTML and **not** `<Dashboard>`.

| Near term | Long term |
|-----------|-----------|
| Stack **TBD with owner in Slice 0** (Tailwind is the default hypothesis) | Effect `Hydration` / `HydrationBoundary` (not Next) — hook only, no impl now |
| Agent pages = **HTML in repo** under `content/` | Same app grows into full public site |
| `pnpm run docs:serve` — Tailscale **read** on phone | |

**Pattern reference (not a commitment):** `examples/resource-web/` (Vite, `host: true`, React entry) — **not** its Dashboard import.

---

## Slice 0 — Plan with the owner (no code)

**Goal:** Turn locked architecture decisions into an **implementation plan the owner signs off on** before any build.

### How to run the conversation

1. **Read** [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md), [`docs/site/README.md`](../site/README.md), and skim the existing `docs/site/` scaffold — know what exists, do not change it yet.
2. **Open with 3–5 questions** (pick the highest-uncertainty ones first; do not dump all at once).
3. **Listen** — follow up on answers; ask clarifying questions until tradeoffs are clear.
4. **Summarize** a short plan (stack, folder layout, content format, phone UX, what Slice 1 will ship).
5. **Wait for explicit owner approval** (`yes`, `ship it`, `approved`, or equivalent) before Slice 1.
6. **Write the plan** to `docs/handoffs/agent-b-plan.md` after approval — that file is the contract for Slices 1–5.

### Questions to ask (use as a menu — not a questionnaire dump)

Ask what you need; skip what the decision doc already locks.

| Topic | Example questions |
|-------|-------------------|
| **Styling** | Is Tailwind the right fit for *agents writing HTML* long-term? Would you rather semantic CSS classes + tokens, plain CSS linked from a shared stylesheet, or something else? How important is matching `/web` Dashboard visuals vs a distinct docs look? |
| **Content shape** | Should agent pages be raw `.html` fragments, full documents, or MDX-like? Who owns layout chrome — shell wraps content, or each page is self-contained? |
| **Phone read** | What does “good enough” on phone look like — nav drawer, TOC, font size, dark mode? Anything you’ll never need on phone? |
| **Site scope (near term)** | Standards corpus only first, or also package landing, changelog, API index? What’s the first page you want to read on your phone? |
| **Machine index** | How much structure do agents need (`manifest.json`, `data-rule-id`) vs human-readable HTML only? |
| **Throwaway tolerance** | What would feel wasted if we redo it in a month? What must survive the first cut? |
| **Foldkit** | Still no interest, or worth a 10-minute side-by-side before deciding? |
| **Build slices** | OK to ship a minimal shell first (serve + one page + phone URL) before nav/manifest/build pipeline? |

### Slice 0 deliverables (after owner approves)

- [ ] `docs/handoffs/agent-b-plan.md` — locked plan (stack, layout, content contract, slice order)
- [ ] Owner approval quoted or paraphrased in that file
- [ ] `agent-status.md` row updated: B → **planning-done** or **building**

### Slice 0 anti-patterns

- Do **not** recommend-and-proceed without owner reply
- Do **not** start Vite/React/Tailwind setup in Slice 0
- Do **not** present a fait accompli PR

---

## Target layout (hypothesis — confirm in Slice 0)

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

## Slices (one branch — start Slice 1 only after Slice 0 plan approved)

### 1 — Vite React app + Tailscale serve

Per **`agent-b-plan.md`**. Typical deliverables:
- `docs/site/app/` per approved stack (e.g. `resource-web` pattern: React, styling per plan, `theme.css` if chosen)
- `pnpm run docs:serve` → `0.0.0.0:5190`
- README: Tailscale **read** URL for phone

### 2 — Load agent HTML pages

- Shell renders `content/**/*.html` (fetch at dev, build copies to dist)
- Mobile-readable typography per plan

### 3 — Nav from `content/standards/manifest.json`

- Add `content/standards/meta.html` — template for Agent A (`data-rule-id`, classes per plan)

### 4 — `docs:build` + `docs:preview`

- Production build includes all content HTML; preview uses `host: true`

### 5 — Handoff + ship

- README: “Agent A: add a chapter” (format per `agent-b-plan.md`)
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

- [ ] Slice 0: owner-approved `agent-b-plan.md`
- [ ] Bespoke app serves on Tailscale phone (read)
- [ ] Agent HTML pages render per plan
- [ ] `meta.html` + manifest nav
- [ ] `docs:build` / `docs:preview` green

## Status

- [ ] Slice 0 — planning conversation (no code yet)
