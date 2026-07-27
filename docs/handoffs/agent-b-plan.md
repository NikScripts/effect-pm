# Agent B — implementation plan (Djot + Effect + Waku RSC docs app)

**Status:** **LOCKED** (owner approved 2026-07-09). Contract for Slices 1–5.
**Owner steer at approval:** seed the app with *a few short instructional pages on the most core functional features* (best-effort, using real APIs) — the full standards corpus is Agent A's, not this agent's. First pages = instructional, not a marketing landing. Island in v1 may be a stub seam.
**Branch:** `action/html-doc-platform` (rebase onto current `origin/integration/storage` in Slice 1).
**Supersedes:** the "HTML + Tailwind" content row in [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md) (owner-approved change, 2026-07-09) and the generic-HTML approach in the older [`agent-b-html-doc-platform.md`](./agent-b-html-doc-platform.md).

---

## How we got here (owner decisions, this session)

1. **Option 6 stands** — bespoke Vite + React + Waku RSC app that becomes the official `hyperlink-ts` website. Not Next, not Foldkit, not the `<Dashboard>`.
2. **Content is Djot, not Markdown or HTML+Tailwind.** Markdown fails the owner's bar (no real AST, no attribute escape hatch). Djot: clean raw source, a defined AST, and a *sparing* `{…}` attribute syntax used only at rule boundaries.
3. **Styling is classless.** No utility-class soup in content. Element-selector CSS on `src/web/theme.css` tokens; the only classes are functional metadata Djot emits (`.must/.should/.may`, `.note`).
4. **Auto HMR on content edits is mandatory**, and **no `node:fs`** — content loads through Vite's module graph. **Effect packages everywhere, including `effect/unstable/*`.**

### Proven in spike (real code — `effect@4.0.0-beta.92`, `react@19.2.7`, `@djot/djot`, `waku@1.0.0-beta.3`)

- Djot → **Effect service**: parse, `Schema`-validate rule metadata, generate manifest from the AST, **typed `DuplicateRuleId` failure** (bad content fails the build, not silently).
- Effect → **React server components** via an AST→React walker.
- **Waku RSC** dev binds `0.0.0.0:5190`, HTTP 200 over Tailscale `100.67.32.32`.
- **Live-island seam**: a ` ```queue ` block renders to `data-island="queue-widget"` through Waku SSR — the seam where a live Effect `<QueueWidget/>` hydrates.
- `waku build` → **static SSG**; `dist/public/index.html` is the fully-rendered doc. Phone reads static, no live server.

### Blockers/gotchas the spike pinned (baked into this plan)

| Gotcha | Resolution |
|--------|-----------|
| `waku@1.0.0-beta.6` — `react-server` export condition not wired → 500 on every page | **Pin `waku@1.0.0-beta.3`**; revisit when a later beta fixes it |
| Zero-config Waku doesn't wire RSC conditions | **`waku.config.ts` with `@vitejs/plugin-react`** is required |
| Content read via `node:fs` → outside module graph → **no HMR** | **`import.meta.glob('…?raw')`** — content is a module dependency, HMR fires; also satisfies "no fs" |
| `.` inside a Djot id becomes literal text | **Dotless section ids**; the build composes the qualified `page.rule` id |
| Djot attribute block inline on a heading is ignored | **Attribute block on its own line above** the heading |

---

## Locked stack

| Layer | Choice |
|-------|--------|
| **Framework** | Waku `1.0.0-beta.3` (RSC over Vite), file-router `docs/site/app/pages/` |
| **Runtime** | React 19 server components; dual Effect runtime — `RuntimeServer` (docs layer) for server components, `RuntimeClient` (`Atom.runtime(layer)`) for islands |
| **Content format** | **Djot** (`.dj`), rendered `@djot/djot` `parse` → AST |
| **Content loading** | **`import.meta.glob('/content/**/*.dj', { query: '?raw', import: 'default', eager: true })`** — module-graph, HMR, **no `node:fs`** |
| **Content pipeline** | Effect service: parse → `Schema`-validate → derive manifest → render (AST→React). Typed errors fail the build. |
| **Styling** | Classless CSS on `src/web/theme.css` oklch tokens; light/dark; severity + `.note` accents only |
| **Islands** | Vendored `atom/react` (`RegistryProvider`, `HydrationBoundary`) — the `queue-widget` pattern, `effect/unstable/reactivity` |
| **Machine index** | `manifest` derived from the AST at build — **never hand-authored** |
| **Disk writes (if any)** | `@effect/platform-node` `NodeFileSystem` layer + Effect `FileSystem` service — **never `node:fs`** |

---

## Target layout

```
docs/site/
├── app/
│   ├── pages/
│   │   ├── _layout.tsx        # html shell, classless <style>, nav (server component)
│   │   ├── index.tsx          # landing (later); docs index
│   │   └── standards/
│   │       └── [chapter].tsx  # server component: glob raw .dj → Effect pipeline → React
│   ├── lib/
│   │   ├── content.ts         # import.meta.glob('?raw') → { id → raw } map (HMR source)
│   │   ├── DocsContent.ts     # Effect service: parse/validate/manifest/render (AST→React)
│   │   └── runtime.ts         # RuntimeServer / RuntimeClient
│   ├── islands/
│   │   └── QueueWidget.tsx    # 'use client' — HydrationBoundary demo island (stub ok in v1)
│   └── styles/
│       └── docs.css           # classless stylesheet on theme.css tokens
├── content/
│   └── standards/
│       ├── meta.dj            # authoring template for Agent A
│       └── *.dj               # Agent A writes chapters here
├── waku.config.ts             # plugin-react (RSC conditions)
└── README.md                  # Tailscale read URL + "Agent A: add a chapter"
```

`docs/site/`'s old static scaffold (`index.html`, `standards/index.html`, `content/markdown-index.html`, plain `vite.config.ts`, `public/assets/site.css`) is **replaced** by the Waku app in Slice 1. The Slice-1 spike commit `dac86513` (README Tailscale section) is **kept and adapted**. The parked Slice-2 stash (vanilla `nav.js`/`meta.html`) is **discarded** — superseded.

---

## Slices (one branch; start only after approval)

### Slice 1 — Waku app + Tailscale serve + **HMR gate**
- Rebase `action/html-doc-platform` onto current `origin/integration/storage` (decision doc + handoffs land on the branch).
- Scaffold `docs/site/app/` (Waku), `waku.config.ts` (`@vitejs/plugin-react`), pin `waku@1.0.0-beta.3`.
- Rewrite `package.json` scripts: `docs:serve` = `waku dev --host 0.0.0.0 --port 5190` (`DOCS_PORT`), `docs:build` = `waku build`, `docs:preview` = `waku start`.
- Content via `import.meta.glob('?raw')`; one real chapter renders through a server component + the Effect pipeline.
- **Acceptance gate (owner requirement):** edit a `.dj` on the desktop → phone **auto-refreshes**, **no restart**, **no `node:fs` anywhere**. If Waku `render:'static'` caches in dev, use `render:'dynamic'` in dev / static in build. Ship nothing until this is verified live.
- Carry the README Tailscale/firewall section over.
- **Verify:** `docs:serve` log + curl over tailnet + a demonstrated content edit auto-reloading.

### Slice 2 — Effect content pipeline + classless render
- `DocsContent` Effect service: `parse` → `Schema`-validate rules (`Schema.Literals` severity) → derive manifest → reject duplicates (`Data.TaggedError`) → AST→React walker. `RuntimeServer` provides it to server components.
- `docs/site/app/styles/docs.css` — classless, `theme.css` oklch tokens, light/dark, severity stripes + `MUST/SHOULD/MAY` markers + `.note`.
- **Verify:** rendered chapter matches the spike's served look on the phone; a malformed rule id / duplicate **fails the build with a typed error** (show the output).

### Slice 3 — Manifest-driven nav + island seam + content contract
- Nav generated from the derived manifest (chapters), on `_layout` + docs index — adding a `.dj` updates nav with no shell edit.
- Island seam wired: ` ```queue ` → `islands/QueueWidget.tsx` (`'use client'`) via `HydrationBoundary`. A stub island is acceptable in v1; real `WorkPool` wiring is a stretch goal.
- Write the **content contract** into `content/standards/meta.dj` (see Agent A handoff below).
- **Verify:** new chapter appears in nav; island hydrates (or stub renders) in SSR + client.

### Slice 4 — Production build + preview over Tailscale
- `waku build` → SSG; confirm `dist/public` contains fully-rendered chapters (grep the content).
- `docs:preview` (`waku start`) serves `0.0.0.0:5190` for a phone check.
- `dist/` in `.gitignore`.
- **Verify:** build log (`[ssg] … files generated`) + curl of a static file showing rendered doc.

### Slice 5 — meta chapter + Agent A handoff + PR
- Finalize `content/standards/meta.dj` (authoring template) — dotless ids, attribute-on-own-line, severity classes, no prose classes.
- README **"Agent A: add a chapter"** — write a `.dj` in `content/standards/`, refresh phone; nav + manifest auto-update.
- Comment the future `HydrationBoundary` / `Hydration.dehydrate` seam in `runtime.ts` — **no implementation**.
- Update `agent-status.md`; PR → `integration/storage`.

---

## Agent A content contract (what Slice 5 hands off)

Agent A writes `content/standards/*.dj`. Per chapter:

```djot
{#module-layout title="Module layout" appliesTo=src}
# Module layout

Intro prose — plain Djot, zero classes.

{#public-barrel .must appliesTo=src}
## Public surface goes through the barrel

Rule prose. `inline code`, *emphasis*, fenced code blocks.

{.note}
An optional callout.
```

Rules for Agent A:
- **Page block first:** `{#page-id title="…" appliesTo=…}` above the `#` H1.
- **One rule = one section** with `{#dotless-id .severity appliesTo=…}` on its own line above the `##` heading. `severity ∈ {must, should, may}`.
- **No `.` in ids** (build composes `page-id.rule-id`). **No classes in prose.** Metadata only via `{…}` blocks.
- **No manifest editing** — it's derived from the AST. **No `node:fs`, no HTML.**

---

## Out of scope

- Full standards corpus (Agent A) · audit (Agent C) · `<Dashboard>`/ops widgets · Next.js · Foldkit · `src/` edits beyond importing `theme.css` tokens · real RSC `Hydration.dehydrate` SSR (future seam only).

## Done when

- [ ] `docs:serve` on Tailscale, **content edit auto-reloads on phone, zero `node:fs`**
- [ ] Djot chapter renders classless via the Effect pipeline; typed build failure on bad content
- [ ] Manifest-driven nav; island seam wired
- [ ] `docs:build` SSG + `docs:preview` green
- [ ] `meta.dj` + README "add a chapter"; PR to `integration/storage`
