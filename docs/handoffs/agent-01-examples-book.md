# Agent 1 — Examples book (Twoslash-paired)

**Status:** owner direction 2026-07-15 — **priority over remaining legacy recipe ports**.  
**Agent:** 1 (content + `docs/nav.ts`). **Site wiring / More filter:** Agent B (short ask below).

---

## Product model (locked)

| Piece | Where | Sidebar? |
|-------|-------|----------|
| **Examples hub** | `docs/examples.md` (or `docs/examples/index.md` — decide on first PR) | **Yes** — one nav entry |
| **Paired example docs** | `docs/examples/<module>/<name>.md` | **No** — linked only from the hub (and deep links) |
| **Runnable source** | `examples/**` (unchanged) | n/a |

- Each **teaching** example file gets a **near-identical** doc with `{.twoslash}` (LSP/hover on).  
- Hub lists every example doc, **grouped by module**, with **`#` anchors** per group (and preferably per example) so guides can link `…/examples#queue` or `…/examples/queue/queue-resource-priority-retry`.  
- Individual example docs stay `status="draft"` until tip-checked.

### Not this work

- Do **not** port `toolkit-by-example` as a Guides chapter (recipe strip ≠ guide; superseded by paired examples).  
- Do **not** put 50+ example slugs into `nav.ts`.  
- Full apps (`hyperlink-tui`, `hyperlink-web`, `web-dashboard`) are **later batches** — prefer `examples/forms/` first (one shape per file).

---

## Priority vs legacy (decision)

**Examples book first.** Remaining Phase 3 legacy work (processes placeholder, pointer stubs, PACKAGE-GUIDE) is **background / later**. Stores port already landed; don’t spend the track on recipe-TOC ports.

Why: runnable `examples/` is closer to tip truth; Twoslash-paired docs compound that; leftover legacy cheat sheets rot and duplicate living guides.

---

## Batches

| Batch | Scope | Status |
|-------|-------|--------|
| **E0** | Model + B ask (content glob + exclude example docs from “More”) | **done** (glob + More filter landed with E1) |
| **E1** | Hub page + nav slug `examples` + first paired docs: **forms/queue** (2) | **in flight** |
| **E2** | forms/hyperlink (9) | next |
| **E3** | forms/schedule + polling + process-store + store + dynamic-config | |
| **E4** | scenarios / serve-per-hyperlink / remaining root scripts | |
| **E5** | Large apps (tui / web / dashboard) — owner call; maybe “scenario” page not 1:1 every file | |

---

## Agent B — requirements note (chrome / wiring)

Needed so hub-linked pages don’t spam **More** in the sidebar:

1. Glob `docs/examples/**/*.md` (and hub) in `docs/site/src/lib/content.ts`.  
2. When building nav extras, **exclude** slugs under the examples group **except** the hub slug listed in `nav.ts`.  
3. Twoslash already works on guides — reuse for example docs; no new badge chrome.

Agent 1 can author markdown + `nav.ts` before B lands; pages won’t render until (1).

---

## Pairing convention

```
examples/forms/queue/queue-resource-priority-retry.ts
→ docs/examples/queue/queue-resource-priority-retry.md
```

Doc: page block + short lead + `{.twoslash}` fence mirroring the `.ts` (trim harness/`runNodeProgram` noise where it hurts hover; keep the API under demo). Link back: `Run: pnpm run example:…` + path to source.
