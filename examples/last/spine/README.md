# last-ts spine demo

**Acceptance bar for “package done” before Last site / Hyperlink dogfood.**  
Lock: [`docs/handoffs/last-ts-spine.md`](../../../docs/handoffs/last-ts-spine.md)  
Twoslash: [`docs/examples/last/last-ts-spine.md`](../../../docs/examples/last/last-ts-spine.md)

## Product surface (this tree)

| Piece | Where |
|-------|--------|
| Page mints | `src/pages/*.tsx` — `Page.make` / `Page.static` |
| Soft-nav catalog | `src/lib/site.ts` — `Router` / `Route` / `RouterBuilder` / `urls` |
| Document | `src/lib/document.tsx` — `Document.provide` |
| Provider | `src/lib/Provider.tsx` — `Last.provider` + transport Layer |
| Path unions | `src/paths.gen.ts` — `fileRouter` |

**Deleted (not product):** `waku.server.tsx`, `_root.tsx`, app-authored Waku `createPages` /
`createRoot` / `createLayout`.

## Typecheck

```bash
pnpm exec tsc -p examples/last/spine/tsconfig.json --noEmit
pnpm hyp file-router check \
  --pages examples/last/spine/src/pages \
  --out examples/last/spine/src/paths.gen.ts
```

## Acceptance

| # | Check |
|---|--------|
| 1 | `Page.static` home (JSX body) |
| 2 | `Page.make` about with `Effect` body |
| 3 | Param page `Page.static` with nested `{ params }` |
| 4 | Soft-nav: `Router.make` + `Route.get` + `RouterBuilder.handle(mint)` |
| 5 | `Layout.provide` on the page group |
| 6 | `Document.provide` (title + titleTransform) in Layer |
| 7 | One `Last.provider(layer)` bake |
| 8 | Soft-nav `Link`s hit typed `urls.*` |
| 9 | `fileRouter` → committed `paths.gen.ts` |

**Still open:** host bridge that maps product APIs → engine without apps authoring Waku
`createPages` (internal only). `Page.document` during host RSC Effect run.
