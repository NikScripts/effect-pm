# Agent 1 — Docs corpus: handoffs → plans → legacy (Draft)

**Status:** **PHASE 1 BATCHES A–D LANDED** (2026-07-14) — archive under `handoffs/archive/2026-07/`; SSOTs + deferred rows still at root.  
**Phase 1 plan:** [`agent-01-docs-corpus-phase1-plan.md`](./agent-01-docs-corpus-phase1-plan.md). Still awaiting owner for batch **E** (SSOT layout) / **Z** (deletes) / Phases 2–3.  
**Agent:** **1**.  
**Branch from:** **`integration`**.  
**Working branch:** landed on **`integration`** via [#54](https://github.com/NikScripts/effect-pm/pull/54) + [#55](https://github.com/NikScripts/effect-pm/pull/55).

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · [`docs/standards/documentation.md`](../standards/documentation.md) · [`docs/nav.ts`](../nav.ts) · [`docs/site/src/lib/content.ts`](../site/src/lib/content.ts)

---

## Owner steer

- **UI / docs-site chrome / dashboard / Tailscale preview UX** — reserved for **lettered local agents** (B owns `docs/site/`; A/C/D as assigned). **Agent 1 does not touch** `docs/site/**` UI, Twoslash popover CSS, dual-preview chrome, or `src/web` / `src/ui`.
- **Work the written corpus instead**, in this order:
  1. **Handoffs cleanup** (this phase — start here)
  2. **Plans refactor + migration** (after owner unlocks)
  3. **Port legacy docs** into the live book — with a **Draft** page label (details owner will refine after this brief is assigned; do **not** invent the Draft UX in site code)
- **Plan first** for Phase 1: inventory + proposed action per file/class. Then stop for approval. No mass deletes without owner go.

---

## Current docs map (facts on `integration`)

| Area | Path | Served by site? | Format today |
|------|------|-----------------|--------------|
| Live book | `docs/index.md`, `getting-started/`, `resources/`, `guides/`, `observe/`, `standards/` | **Yes** (`content.ts` glob) | `.md` with Djot-style `{#id title=…}` blocks (Djot prototype — see standards *Documentation*) |
| Handoffs | `docs/handoffs/**` (~87 `.md`) | **No** | Agent/session notes, plans-in-handoffs, reviews, roadmaps |
| Legacy | `docs/legacy/**` (guides, PACKAGE-GUIDE, STORAGE, plans, …) | **No** | Pre-site markdown; often stale vs tip |
| Orphan roots | e.g. `docs/LOGS.md` | **No** (not in glob) | Should eventually live under `guides/` or similar |
| Plans (legacy) | `docs/legacy/plans/` | **No** | Roadmap + a few design specs |
| Plans (scattered) | handoffs `*-plan.md`, design docs | **No** | Mixed with agent briefs |

**Important:** There are **zero** `.dj` files in-repo. The site still loads **`.md`**. “Convert to Djot” means align content with the Djot **conventions** in `documentation.md` (page blocks, rule blocks) — not a mass rename to `.dj` unless owner later unlocks a site change (that’s lettered-agent territory).

---

## Phase 1 — Handoffs cleanup (START HERE)

### Goal

Make `docs/handoffs/` legible again: what is **active**, what is **historical SSOT**, what can be **archived or deleted**, without breaking the supervisor bus.

### Keep live (do not archive without owner)

| File | Role |
|------|------|
| `agent-status.md` | Supervisor dashboard |
| `owner-decisions.md` | Locked steers |
| `supervisor-protocol.md` (if present) | Process |
| Active agent briefs with open work | e.g. Agent 3 logs follow-ups, Agent D handle follow-ups, Agent B/C plan-first |
| **Decision SSOTs still cited by code/docs** | e.g. `multi-host-instances-decisions.md`, `queue-handle-convergence-decisions.md`, store transform decisions |

### Likely archive / trim candidates (confirm in plan — do not mass-delete in plan-only)

| Class | Examples | Proposed fate options |
|-------|----------|------------------------|
| Merged closeouts | Agent 1/2 closeouts, process-run-rpc, queue wire 1a, store-cutover-*.md when marked done | `handoffs/archive/` **or** delete + pointer in status |
| Date-stamped findings | `2026-07-01-*.md` | Archive folder by month |
| Withdrawn briefs | `agent-cursor-logs-store-cutover.md`, superseded prototypes | Delete or archive with “superseded by …” one-liner |
| Duplicate reviews | phase5 review once P1 absorbed | Fold into `whats-changed` / LOGS / delete |
| Reports bus | `handoffs/reports/` | Keep index; archive stale agent reports |

### Phase 1 deliverable (plan only — post in owner chat)

1. **Inventory table** of every `docs/handoffs/*` file (or grouped by class): path · one-line role · **active / historical SSOT / archive / delete** · evidence (merged PR, superseded by X).  
2. **Proposed tree** (e.g. `handoffs/archive/2026-07/`, keep root for live bus only).  
3. **Rules** for what stays at root forever (`agent-status`, `owner-decisions`, …).  
4. **Ripple check:** links from `docs/legacy/`, guides, `AGENTS.md`, standards — what breaks if we move files.  
5. **Out of scope list:** anything under `docs/site/`, Dashboard, UI.

Then **stop**. After owner unlocks: execute moves/deletes + fix links + update `agent-status` pointers; commit + push.

---

## Phase 2 — Plans refactor & migration (owner unlock later)

**Do not start until Phase 1 is approved and landed (or owner says parallelize).**

### Goal

One coherent place for **future / not-yet-shipped** design, separate from agent briefs and from shipped guides.

### Known plan surfaces today

- `docs/legacy/plans/` — roadmap README + hybrid storage, treeshaking, weighted middle scheduling (many items may be **obsolete** post-Store / Logs / Host→Node rename).  
- Handoff `*-plan.md` / design docs used as living plans.  
- Shipped behavior wrongly stranded in plans → should move to **guides** or be deleted.

### Deliverable when unlocked

Plan again: inventory every plan-ish doc · keep / rewrite / migrate to guide · delete obsolete · propose `docs/plans/` (or other) vs keep under legacy. Owner picks layout before moves.

---

## Phase 3 — Legacy docs → live book + Draft label (owner unlock later)

**Do not start until Phase 2 unlocked (or owner reorders).**

### Goal

Port still-useful `docs/legacy/**` content into the live book (`getting-started` / `resources` / `guides` / `observe`), then retire or shrink legacy.

### Draft label (stub — owner will expand after assign)

- Ported pages that are **not yet tip-accurate** must be marked **Draft** so readers don’t treat them as SSOT.  
- **Agent 1:** propose **content-side** conventions only (e.g. page-block metadata, a `{.note}` / `{.draft}` callout, front-matter field, nav badge text in the markdown itself).  
- **Do not** implement site chrome, CSS badges, or `content.ts` changes — that is **lettered-agent / Agent B** work after owner specifies the Draft UX.  
- If a Draft marker needs a site feature, open a **short requirements note** for Agent B; do not build it.

Also decide fate of orphans like `docs/LOGS.md` (candidate: become `docs/guides/logs.md` + nav slug — still content-only in this phase unless B is looped in for nav).

---

## Hard boundaries

| Do | Do not |
|----|--------|
| Edit `docs/handoffs/`, `docs/legacy/`, live book `.md` content | Edit `docs/site/**` UI/CSS/Twoslash chrome |
| Fix broken links after moves | Touch `src/web`, `src/ui`, dashboard widgets |
| Align page blocks with Documentation standard | Rename everything to `.dj` / change Vite globs without owner + B |
| Plan-first each phase | Mass-delete handoffs without inventory approval |
| Push on `cursor/docs-…-a009` off `integration` | Mix Logs/handles/engine work into this track |

---

## Verification (when executing)

- Inventory committed; no dangling links from live book → moved paths.  
- `pnpm run docs:manifest:check` (or project equivalent) if standards pages change.  
- Do **not** require Tailscale/`docs:serve` for Agent 1 — lettered agents verify site UX.

---

## Short prompt (paste to Agent 1)

```
Branch from integration:
  git fetch origin integration && git checkout integration && git pull

Read docs/handoffs/agent-01-docs-corpus.md

You are Agent 1. Docs corpus track. UI / docs-site chrome / dashboard = lettered agents only — do not touch docs/site UI.

PHASE 1 ONLY for now: handoffs cleanup. PLAN FIRST.
Deliver the inventory table (every handoffs file or grouped class → active / historical SSOT / archive / delete), proposed tree, keep-forever rules, and link-ripple check. Do not mass-delete yet. Then stop for owner approval.

Phases 2–3 (plans migration; legacy port + Draft label) wait for later unlock.
```
