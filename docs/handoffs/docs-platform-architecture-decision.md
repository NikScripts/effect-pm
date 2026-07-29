# Docs + website platform — architecture decision

**Status:** **LOCKED** (owner 2026-07-09) — Agent B may restart on Option **6**.  
**Supersedes:** paused generic HTML scaffold rationale.

---

## Owner decisions (locked)

| Question | Answer |
|----------|--------|
| Phone use | **Read only** on Tailscale — not editing on phone |
| End state | This application becomes the **official website** for `hyperlink-ts` |
| Content model | **Written in code by agents** — like Markdown today, but **HTML + Tailwind** (machine- and human-readable) |
| Throwaway work | Minimize — docs will be a **bespoke docs application**, not a disposable static site |
| Dashboard (`/web`) | **Separate** ops dashboard short term; docs app may share **Tailwind tokens / visual language**, not `<Dashboard>` widgets |
| Foldkit | **Not preferred** — optional demo only if curiosity remains |
| RSC | **Not Next.js** — future path is Effect **`Hydration`** / `@effect/atom-react` (`HydrationBoundary`), per `effect/unstable/reactivity` (see vendored `repos/effect/packages/atom/react`) |

---

## Chosen direction — Option 6: Bespoke docs app (Vite + Tailwind + agent HTML)

### Near term (Agent B → A → C)

```
docs/site/
├── app/                    # Bespoke docs application shell
│   ├── main.tsx            # Vite entry (pattern: examples/hyperlink-web)
│   ├── DocsApp.tsx         # Layout, nav, mobile-readable chrome
│   └── vite.config.ts      # host: true, port 5190 — Tailscale read
├── content/                # Agent-authored pages (HTML + Tailwind classes)
│   └── standards/          # Agent A corpus (*.html)
├── public/
└── manifest.json           # Nav + rule index (machine-readable)
```

| Layer | Stack |
|-------|--------|
| **Shell** | Vite 6 + React + Tailwind v4 + `src/web/theme.css` tokens (same family as `/web`, **not** Dashboard bundle) |
| **Pages** | Static **HTML files with Tailwind** in repo — agents edit source, Vite HMR, phone refresh to read |
| **Serve** | `pnpm run docs:serve` — `0.0.0.0:5190` |
| **Machine index** | `manifest.json` + `data-rule-id` on `<article>` in HTML (Agent A) |

**Explicitly not building:** generic unstyled HTML, Dashboard embed, Foldkit, Next.js.

### Long term (architecture hooks only — no implementation now)

- Effect **`Hydration.dehydrate` / `hydrate`** + `HydrationBoundary` when bespoke app needs SSR/RSC-style delivery — **not Next**
- Marketing + docs + package site = **one bespoke app**; ops dashboard may remain `hyperlink-ts/web` or converge later

---

## Rejected / deferred

| Option | Verdict |
|--------|---------|
| Plain HTML + minimal `site.css` only | Rejected — too throwaway, not official-site quality |
| Dashboard as docs host | Rejected — wrong product surface |
| Foldkit | Deferred — demo optional, not default |
| Next.js RSC | Rejected — use Effect Hydration path instead when ready |

---

## Decision table

| Field | Value |
|-------|-------|
| **Chosen option** | **6 — Bespoke docs app** |
| **Content format** | Agent-written **HTML + Tailwind** in `docs/site/content/` |
| **App shell** | React + Vite + shared `theme.css` tokens |
| **Dashboard relationship** | Separate apps; shared design tokens only |
| **RSC future** | Effect `Hydration` / atom-react — not Next |
| **Foldkit** | Optional spike only; owner not impressed |
| **Agent B restart** | **Unblocked** — see [`local-agents.md`](./local-agents.md) § Agent B |

---

## Agent impact

| Agent | Status |
|-------|--------|
| **B** | **Unblocked** — build bespoke shell + load agent HTML pages |
| **A** | Blocked on B — writes `content/standards/*.html` with Tailwind |
| **C** | Blocked on A |

Update [`agent-status.md`](./agent-status.md) when B starts.

---

## Reference: shipped dashboard (separate product)

`hyperlink-ts/web` — `examples/apps/web/app.tsx` — remains the **ops** dashboard. Docs app reuses **tooling and theme**, not `Dashboard.tsx`.

## Reference: Effect RSC (future)

- `effect/unstable/reactivity/Hydration` — `dehydrate`, `hydrate`, `toValues`
- `@effect/atom-react` — `HydrationBoundary`
- `examples/apps/queue-widget/README.md` — prior mention of Hydration for RSC experiment
