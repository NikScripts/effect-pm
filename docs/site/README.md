# Documentation site (`docs/site/`)

Live HTML documentation for effect-pm — **served from day one** for Tailscale / phone reading while agents edit.

## Quick start (home server + Tailscale)

```bash
pnpm run docs:serve
```

| Setting | Default |
|---------|---------|
| Port | `5190` (`DOCS_PORT=8080 pnpm run docs:serve` to override) |
| Bind | `0.0.0.0` (all interfaces — required for Tailscale) |
| Phone URL | `http://<your-tailscale-ip>:5190/` |

Vite HMR reloads when HTML/CSS under `docs/site/` changes — save a file, refresh the page on your phone.

## Agent pipeline (order matters)

| Phase | Agent | Handoff | Delivers |
|-------|-------|---------|----------|
| **1** | **B** | [`handoffs/agent-b-html-doc-platform.md`](./handoffs/agent-b-html-doc-platform.md) | Vite server, nav, `meta.html` template, `docs:build` |
| **2** | **A** | [`handoffs/agent-a-html-standards-corpus.md`](./handoffs/agent-a-html-standards-corpus.md) | `standards/*.html` + populated `manifest.json` |
| **3** | **C** | [`handoffs/agent-c-standards-audit.md`](./handoffs/agent-c-standards-audit.md) | `audits/*.html`, strict fix PRs |

**Stack:** Vite 6 + Tailwind v4 (aligned with `src/web/` and `examples/resource-web/`). React shell optional — plain HTML chapters are fine initially.

## Layout

```
docs/site/
├── index.html              # Home
├── vite.config.ts          # host: true, port 5190
├── public/assets/site.css
├── standards/              # Normative HTML corpus (Agent A)
│   ├── manifest.json
│   └── *.html
├── content/                # Auxiliary static pages
└── audits/                 # Agent C reports (later)
```

Legacy Markdown remains in `docs/*.md` until migrated.
