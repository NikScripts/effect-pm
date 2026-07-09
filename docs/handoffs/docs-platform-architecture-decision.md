# Docs + website platform — architecture decision (PAUSED)

**Status:** **BLOCKED** — Agent B stopped until owner picks a stack.  
**Date:** 2026-07-09  
**Context:** First Agent B run built a generic Vite static HTML shell. Owner requirement: align with the **shipped dashboard** (`@nikscripts/effect-pm/web`) or consciously choose a **new** Effect-native stack (Foldkit, RSC, etc.).

---

## What we ship today (dashboard)

| Piece | Reality |
|-------|---------|
| **Package** | `@nikscripts/effect-pm/web` → `src/web/` |
| **Model** | Client SPA — **not RSC** |
| **State** | `effect/unstable/reactivity` (`Atom.runtime`, `AtomRegistry`) |
| **UI** | React 19 + Tailwind v4 + `theme.css` + shadcn-style primitives |
| **Data** | `Resource.client` / RPC; tag-driven widgets (`kindOf`) |
| **Canonical example** | `examples/resource-web/` — thin `app.tsx`: `<Dashboard runtime group />` + Vite `host: true` + proxy to Effect HTTP backends |
| **Older example** | `examples/web-dashboard/` — same `<Dashboard>` but duplicate local `queue-data.ts` |

```tsx
// examples/resource-web/app.tsx — the pattern we dogfood
<Dashboard runtime={runtime} group={ServicesHub} />
```

**Locked in-repo:** hand-crafted widgets per resource kind; no generic introspection; logs/schedule sub-routes via `useGroupRoute`.

---

## What the paused doc scaffold assumed

| Piece | Scaffold (`docs/site/`) |
|-------|-------------------------|
| Server | Vite 6, `host: true`, port `5190`, Tailscale |
| UI | **Plain static HTML** + minimal `site.css` |
| Content | Agent A writes `standards/*.html` (machine `data-rule-id`) |
| Relation to `/web` | “Same family as Tailwind” only — **does not import Dashboard** |

**Gap:** Not the same app shell, components, or runtime as the dashboard you already ship.

---

## Options (investigate before Agent B restarts)

### Option 1 — **Extend shipped dashboard stack** (React + `/web`)

**Shape:** `docs/site/` becomes a Vite app like `resource-web`: imports `@nikscripts/effect-pm/web` (`theme.css`, `cn`, layout primitives), optional thin shell around HTML or MDX content.

| Pros | Cons |
|------|------|
| One visual system with Dashboard | Heavier than raw HTML for agent corpus |
| Dogfoods `src/web` on every doc change | React wrapper around “machine HTML” is awkward unless MDX/components |
| Same Tailscale/serve story as `resource-web` | Standards as plain HTML may fight component model |

**Spike:** `examples/resource-web`-style app under `docs/site/app/` with `DocsLayout` using `Card`, nav, `theme.css`; one standards page rendered as React or embedded HTML.

---

### Option 2 — **Keep lightweight HTML site; share tokens only** (current scaffold direction)

**Shape:** Static `standards/*.html` + Vite serve; import **only** `src/web/theme.css` variables (no React, no Dashboard bundle).

| Pros | Cons |
|------|------|
| Best for Agent A/C machine-readable HTML | **Not** the dashboard UX on phone |
| Fast HMR, tiny bundle | Two “faces” of the product (ops dashboard vs doc reader) |
| Agent C can grep HTML + manifest | Owner may want one website feel |

---

### Option 3 — **Foldkit** ([foldkit.dev](https://foldkit.dev/))

Effect-native frontend (Elm architecture, Schema model, Commands, Snabbdom views). Pre-1.0; SPA today; `Runtime.embed` for incremental adoption per upstream docs.

| Pros | Cons |
|------|------|
| Same Effect ecosystem end-to-end | **Different paradigm** from React Dashboard — likely rewrite or long split |
| Aligns with “Effect everywhere” | Not referenced anywhere in this repo yet |
| Office Hours: SSR discussed, not shipped as RSC | Docs + dashboard = two UI stacks unless migrating Dashboard |

**Spike:** `npm create foldkit-app@latest` in `repos/` or scratch app: one standards chapter + Tailscale serve; compare ergonomics vs `resource-web`.

---

### Option 4 — **RSC / Next-style** (earlier external plans)

**In-repo signals only:**

- `examples/queue-widget/README.md` — future “RSC via `effect/unstable/reactivity/Hydration`”
- `docs/plans/18-unbundled-build-treeshaking.md` — external `apps/web` (wow-sports Next)
- **No** in-repo RSC dashboard implementation

| Pros | Cons |
|------|------|
| Matches “real website” + SEO | Greenfield; no scaffold in effect-pm |
| Server-rendered docs possible | Split from shipped Vite SPA Dashboard unless full platform migration |

**Spike:** Clarify whether production site is still Next+RSC (wow path) or in-monorepo Vite.

---

### Option 5 — **Hybrid roadmap** (explicit split)

| Surface | Stack | When |
|---------|-------|------|
| **Ops dashboard** | Keep `@nikscripts/effect-pm/web` | Now |
| **Standards corpus** | Static HTML + Vite serve (Option 2) | Agent A/C now |
| **Public marketing site** | RSC/Next or Foldkit | Later migration |

Requires owner OK on **two UIs** short term.

---

## Decision questions (owner)

1. **Phone reading while editing** — must docs look like the **Dashboard** (chrome, nav, theme), or is a **simple readable HTML** reader enough?
2. **Single stack mandate** — must docs platform and dashboard share **React `/web`**, or can standards stay HTML while dashboard stays React?
3. **Foldkit** — evaluation spike authorized? Any appetite to **migrate** dashboard long-term, or docs-only experiment?
4. **RSC** — is wow/Next still the production website plan, or should everything live in this monorepo under Vite?
5. **Agent pipeline** — does Agent A still write **raw HTML**, or **React pages** / MDX if Option 1 wins?

---

## Recommended investigation order (supervisor)

1. **Read** `examples/resource-web/` + `src/web/Dashboard.tsx` — cost of a `DocsShell` sibling to `Dashboard`.
2. **Timebox Foldkit spike** (4–8 hours) — one page, Effect serve, Tailscale — if owner wants Option 3 data.
3. **Confirm** external RSC plan (wow `apps/web`) with owner — don’t build in-repo RSC until confirmed.
4. **Record decision** in this file § **Decision** below.
5. **Unblock Agent B** with updated [`local-agents.md`](./local-agents.md) § Agent B matching chosen option.

---

## Decision

| Field | Value |
|-------|-------|
| **Chosen option** | _TBD — owner_ |
| **Docs content format** | _HTML / React / MDX / Foldkit views_ |
| **Dashboard relationship** | _same app / shared theme / separate_ |
| **Agent B restart criteria** | _spike complete + handoff updated_ |

---

## Impact on agents

| Agent | Status until decision |
|-------|----------------------|
| **B** | **PAUSED** — do not continue generic HTML-only platform |
| **A** | **BLOCKED** on B |
| **C** | **BLOCKED** on A |
| **Cursor 1–2** | Unrelated — storage/process PRs separate |

When unblocked, update [`agent-status.md`](./agent-status.md) and [`local-agents.md`](./local-agents.md).
