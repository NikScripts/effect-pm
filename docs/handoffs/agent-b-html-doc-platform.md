# Agent B — HTML doc platform (local Claude) — **PHASE 1**

**Order:** **B before A** — serve docs from day one (Tailscale / phone). Agent A writes HTML into this tree after the server works.  
**Agent:** Local Claude (**Agent B**)  
**Branch:** `action/html-doc-platform` from **`integration/storage`**  
**Blocks:** Agent A (standards corpus), Agent C (audit)

**Docs bus (async):** Update [`agent-status.md`](./agent-status.md) on every push.

**Owner chat (mandatory):** After each slice, post **Before / After** code blocks (separate fenced blocks, not diffs). Template in [`supervisor-protocol.md`](./supervisor-protocol.md).

---

## Why first

You work over SSH on a home server with Tailscale. **Live `docs:serve`** means standards HTML updates are readable on your phone as agents edit — no waiting for a full corpus before a server exists.

**Supervisor scaffold (already on `integration/storage`):**

- `docs/site/vite.config.ts` — `host: true`, port `5190` (`DOCS_PORT`)
- `docs/site/index.html`, `public/assets/site.css`, placeholder `standards/index.html`
- `pnpm run docs:serve` (added in package.json)

Your job: turn the scaffold into a **real platform** Agent A and humans use daily.

---

## Read first

| Path | Why |
|------|-----|
| `docs/site/README.md` | Tailscale access, layout |
| `examples/resource-web/vite.config.ts` | `host: true`, `allowedHosts` pattern |
| `src/web/theme.css` | Future style alignment (optional slice) |

---

## Target layout (end of Session B)

```
docs/site/
├── vite.config.ts          # host: true — Tailscale/LAN
├── index.html              # Shell home + nav from manifest.json
├── public/assets/          # site.css (+ optional fonts)
├── standards/              # Agent A writes here — you wire nav + HMR
│   ├── meta.html           # HTML format spec (template for A)
│   ├── manifest.json       # Machine index — you load this in nav
│   └── index.html
├── content/                # Optional static pages (markdown-index, etc.)
└── app/                    # (optional) React shell if plain HTML nav is insufficient
```

---

## Session slices (one branch, complete all)

### Slice 1 — Verify serve + Tailscale

```bash
git checkout integration/storage && git pull
git checkout -b action/html-doc-platform
pnpm run docs:serve
```

- Confirm bind `0.0.0.0:5190` (or `DOCS_PORT`)
- Document in `docs/site/README.md`: `http://<tailscale-ip>:5190/`, firewall note, `DOCS_PORT`
- Post in chat: curl/local URL + `ss` or log line showing listen address

### Slice 2 — Nav from `manifest.json`

- Fetch/load `standards/manifest.json` on `index.html` and `standards/index.html` (vanilla JS or small module — **no React required** unless you prefer)
- When A adds pages, nav updates without editing shell by hand
- Add `standards/meta.html` **template** (empty rules, documents `data-rule-id` format for Agent A)

### Slice 3 — HTML module convention

Define how chapters are served:

- **Option A (preferred):** static `standards/<chapter>.html` files, linked from manifest, Vite HMR on save
- **Option B:** `content/` HTML fragments included via `fetch` + `innerHTML` with sanitization policy documented in `meta.html`

Document choice in `standards/meta.html` and `docs/site/README.md`.

### Slice 4 — Production preview

- `pnpm run docs:build` → `docs/site/dist/`
- `pnpm run docs:preview` — same `host: true` for phone check
- Add `dist/` to `.gitignore` if not already

### Slice 5 — Polish + handoff to Agent A

- Optional: share CSS variables with `src/web/theme.css` (subset only — no dashboard bundle)
- README section **“Agent A: add a chapter”** — copy `meta.html` article pattern, register in `manifest.json`, refresh phone
- PR → `integration/storage`

---

## Out of scope

- Writing the full standards corpus (Agent A)
- Auditing `src/` (Agent C)
- Rewriting `docs/*.md`

---

## Done when

- [ ] `pnpm run docs:serve` works on Tailscale IP from phone
- [ ] Nav driven by `manifest.json`
- [ ] `meta.html` template ready for Agent A
- [ ] `docs:build` + `docs:preview` scripts
- [ ] Chat shows listen URL + file tree

---

## Status

- [ ] Not started (scaffold on integration line — extend it)
