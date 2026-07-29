# Agent 1 — Examples book (Twoslash-paired)

**Status:** owner direction 2026-07-15 — **priority over remaining legacy recipe ports**.  
**Agent:** 1 frozen; **Agent 4** picked up SSOT-include wiring (2026-07-29).  
**Site wiring / More filter:** Agent B (E0 done).

---

## Product model (locked)

| Piece | Where | Sidebar? |
|-------|-------|----------|
| **Examples hub** | `docs/examples.md` | **Yes** — one nav entry |
| **Paired example docs** | `docs/examples/<module>/<name>.md` | **No** — linked only from the hub (and deep links) |
| **Runnable source** | `examples/**` (SSOT) | n/a |

- Hub lists every example doc, **grouped by module**, with **`#` anchors** per group.  
- Individual example docs stay `status="draft"` until tip-checked.

### SSOT + Twoslash include (locked 2026-07-29)

**Do not duplicate** the program into the markdown fence. Pair like this:

```djot
{.twoslash include="examples/work-pool/priority-retry.ts"}
``` ts
```
```

| Concern | Where |
|---------|--------|
| Runnable truth | `examples/.../*.ts` |
| Page-visible slice | Cut markers **in that `.ts`**: `// ---cut---`, `// ---cut-after---`, `// ---cut-start---` / `---cut-end---` |
| Page-only Twoslash directives | Optional fence **body** prepended (e.g. `// @noErrors`) — not required in the runnable file |
| Import style on the page | Site rewrites `../../../src` → `hyperlink-ts`; injects `// @filename: examples/…` so `examples/shared/…` still resolves |
| Glob / HMR | `docs/site/src/lib/example-sources.ts` (+ watcher entries in `waku.config.ts`) |
| Pure helpers (tsx-safe) | `docs/site/src/lib/example-include.ts` |
| Offline check | `docs/site/scripts/check-twoslash.ts` (+ focused `check-twoslash-includes.ts`) |

Guides keep **inline** fences for minimal deltas. The examples book prefers **include**.

### Not this work

- Do **not** port `toolkit-by-example` as a Guides chapter.  
- Do **not** put 50+ example slugs into `nav.ts`.  
- Full apps (`examples/apps/{tui,web,dashboard,…}`) are **later batches** (E5).

---

## Batches

| Batch | Scope | Status |
|-------|-------|--------|
| **E0** | Model + B ask (content glob + exclude example docs from “More”) | **done** |
| **E1** | Hub + nav + WorkPool (2) | **done** (now `include=` SSOT) |
| **E1b** | Include pipeline + daemon store (2) | **done** (Agent 4) |
| **E2** | Gate / HttpApi / Telemetry / FleetHealth / ShardMap | **done** (Agent 4) |
| **E2b** | Node / launcher / wire / defaults | **done** (Agent 4) |
| **E3** | schedule + polling + store + config | **done** (Agent 4) |
| **E4** | scenarios + serve-per-deps + NWSL entry | **done** (Agent 4) |
| **IA** | Drop `forms/` — topic folders + hub rename | **Eng’d** — [`examples-ia-reorg.md`](./archive/2026-07/features/examples-ia-reorg.md) |
| **E5** | Large apps — refactor + app pages | **plan draft** — [`examples-apps-e5-plan.md`](./examples-apps-e5-plan.md); owner lock checklist there |

---

## Pairing convention

```
examples/work-pool/priority-retry.ts
→ docs/examples/work-pool/priority-retry.md
```

Doc: page block + short lead + `{.twoslash include="examples/…"}` empty (or directive-only) fence.  
Link back: `Run: pnpm run example:<topic>-<name>` + path to source + hub anchor.
