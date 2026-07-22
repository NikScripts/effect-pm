# hyperlink-ts docs site (`docs/site/`)

The official `hyperlink-ts` website — a bespoke **Waku (RSC) + Effect** app.
Content is authored in **Djot** (in `.md` files, so GitHub renders them) and rendered
classless; read over Tailscale on your phone.

Architecture + rationale: [`../handoffs/agent-b-plan.md`](../handoffs/agent-b-plan.md) ·
[`../handoffs/docs-platform-architecture-decision.md`](../handoffs/docs-platform-architecture-decision.md).

## Run

```bash
pnpm run docs:serve      # dev  — waku dev on 0.0.0.0:5190
pnpm run docs:build      # SSG  — static site to docs/site/dist/
pnpm run docs:preview    # serve the production build on 0.0.0.0:5190
```

(These proxy to `pnpm -C docs/site {dev,build,preview}`. First time: `pnpm run docs:install`.)

### Read on your phone (Tailscale)

The dev server binds every interface, so any device on your tailnet can reach it.
On the server:

```bash
tailscale ip -4          # e.g. 100.67.32.32
```

Open `http://<that-ip>:5190/` on the phone. **Editing a content file auto-reloads the
page** — Waku emits an `rsc:update` and the browser refetches, no restart, no manual
refresh. To change the port, edit `--port` in `docs/site/package.json`'s `dev` script.

**Firewall:** Tailscale traffic arrives on the `tailscale0`/`utun` interface, which the
macOS application firewall does not gate like the LAN — a fresh `docs:serve` is reachable
over the tailnet with no extra rule. Nothing here is exposed to the public internet.

## How it works

```
docs/{standards,guides}/*.md  →  import.meta.glob('?raw')  →  Effect pipeline        →  Waku RSC server component
docs/index.md (Djot in .md)      (module graph = HMR, no fs)   (parse · validate ·        (SSG in build; classless
                                                                 derive manifest)          HTML; islands via data-island)
```

Content lives at the **`docs/` root** (a sibling of this app), so the site is
presentation only and Agent A owns the content. `docs/legacy/` and `docs/handoffs/`
are never globbed, so they're ignored. `waku.config.ts` sets `server.fs.allow` +
a watcher so out-of-root content edits **and new files** hot-reload.

- **`src/lib/content.ts`** — loads `docs/{index,standards/**,guides/**}.md` from the Vite module graph (HMR, no `fs`).
- **`src/lib/docs-content.tsx`** — the Effect service: `@djot/djot` parse → `Schema`-validated
  rules → derived manifest (typed failures on duplicate ids / missing page block) → AST→React.
- **`src/lib/runtime.ts`** — `runServer` (RuntimeServer seam) + the future `Hydration` island note.
- **`src/pages/`** — Waku routes; `_layout.tsx` owns the chrome and builds nav from the manifest.
- **`src/styles/docs.css`** — classless stylesheet on `src/web/theme.css` tokens.

## Content

Chapters live at the `docs/` root — `docs/standards/` (Agent A's corpus) and
`docs/guides/` — as Djot syntax in `.md` files (named `.md` so GitHub renders them;
parsed as Djot by the pipeline). The authoring format lives in
[`../standards/meta.md`](../standards/meta.md). Quick shape:

```md
{#queues title="Queues" appliesTo=all}
# Queues

Plain Djot prose — no classes, no HTML.

{#priority .must appliesTo=all}
## A rule section carries its metadata on one line
```

- Page block `{#id title="…" appliesTo=…}` above the H1 (required).
- Rule = a `##` section with `{#dotless-id .severity …}` on its own line above it.
- **No `.` in ids**, **no classes in prose**, **no manifest editing** (it's derived).

## Notes

- Waku is pinned to `1.0.0-beta.3` (beta.6 regressed the `react-server` condition).
- Pages render `dynamic` in dev (so edits hot-reload) and `static` in the build (SSG).
