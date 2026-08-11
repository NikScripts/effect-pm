# last-ts spine demo

**Acceptance bar for “package done” before Last site / Hyperlink dogfood.**  
Lock: [`docs/handoffs/last-ts-spine.md`](../../../docs/handoffs/last-ts-spine.md)  
Twoslash (docs site): [`demo.tsx`](./demo.tsx) · page [`docs/examples/last/last-ts-spine.md`](../../../docs/examples/last/last-ts-spine.md)

## Run

```bash
pnpm install   # workspace includes this package
pnpm run example:last-spine
# → http://localhost:5230
```

Typecheck:

```bash
pnpm exec tsc -p examples/last/spine/tsconfig.json --noEmit
pnpm hyp file-router check \
  --pages examples/last/spine/src/pages \
  --out examples/last/spine/src/paths.gen.ts
```

## Acceptance (must all pass)

| # | Check |
|---|--------|
| 1 | `Page.static` home (JSX body) at `/` |
| 2 | `Page.make` about with `Effect` body (host: `Effect.runPromise`, not client `View.effect`) |
| 3 | Param page `Page.static` at `/guides/[slug]` with nested `{ params }` |
| 4 | Host: `Server.fromPage(path, mint)` only — no app `waku` / `getConfig` |
| 5 | Soft-nav: `Router.make` + `Route.get` + `RouterBuilder.handle(mint)` |
| 6 | `Layout.provide` on the page group |
| 7 | `Document.provide` (title + titleTransform) in Layer |
| 8 | One `Last.provider(layer)` bake wrapping `RootLayout` |
| 9 | Soft-nav `Link`s hit typed `urls.*` |
| 10 | `fileRouter` → committed `paths.gen.ts`; CI check green |
| 11 | Dev server serves `/`, `/about`, `/guides/routing` without RSC crashes |

**Gaps the demo already forced us to fix in the package / teaching:**
- Host must not import client `View`/`AtomReact` into RSC (`Server.fromPage` now uses `Effect.runPromise`).
- `Document.Cell` must be `Layer.provideMerge`’d into the provider Layer (plain `Layer.provide` drops it).

**Still open:** `Page.document` during host RSC Effect run (server Document bridge).

Out of scope here: View islands, catch-all routes, Hyperlink chrome, big SSG fans.
