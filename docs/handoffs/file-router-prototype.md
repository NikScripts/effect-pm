# File-router prototype

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng in progress — `Page.*` helpers, `Route.fileRoot`, Vite plugin + `hyp file-router`; **`Page.Service` deferred**  
**Naming:** Layers are always **camelCase** — already `.must` in
[`types-and-naming.md`](../standards/types-and-naming.md#layers-read-as-layers)
(`layer`, `layerMemory`, `componentsLayer`, `peersLayer`, …). No PascalCase layer values.
Dashboard: no `Domain.provide` helper — plain `Layer.provideMerge(*.componentsLayer)`.

## Question

Can we own file-based routing (instead of Waku fs-router) with **fully typed**
file paths as a union?

## Answer

**Yes — with lifecycle codegen + watch** (Vite plugin / `hyp --check`). TypeScript
cannot glob the FS into a closed union; emit stays aligned while `dev` runs.

Proof: `test/ui-file-router-proto.test-d.ts` + `examples/ui/file-router/`.

Disk uses `[param]`; Hyperlink `Route` keeps `:param`. Adapter translates.

## Compose API (dream)

```ts
Route.group("docs").fromEffect(Router.fileSystem("./pages/docs", opts?))
Route.fileSystem("root", "/", { topLevel: true, dir: "./pages" })
Route.fileRoot()                 // root + "/" + topLevel
Route.fileRoot({ dir: "./pages" })
```

## Page mark — `Page.*` + `Page.Service` (locked direction)

Naming detail: [`view-page-naming.md`](./view-page-naming.md) — **not**
`View.Page.Service` (collides with dashboard size chrome). Kill the word **skin**;
use **`componentsLayer`** (or `layer`) for View.succeed bags.

Static/Dynamic/Build exist largely **because** file routing + codegen are
priorities: mark on the module → engine registration; codegen → typed paths.

```ts
import * as Page from "hyperlink-ts/ui/Page"

export default Page.dynamic("/search", SearchView)
export default Page.build("/docs/:chapter", ChapterView, {
  paths: listChapterSlugs, // Effect
})

class DocsChapter extends Page.Service<DocsChapter, ChapterProps>()(
  "app/page/docs-chapter",
  {
    path: "/docs/:chapter",
    render: Page.Render.Build(),
    title: "Docs",
    paths: listChapterSlugs,
  },
) {}
export default Page.build(DocsChapter)
```

`Page.Service` still needs work (statics schema, `Page.build(Tag)`, param Schema, …).

Default unmarked fixed path → Static. Param routes must mark Build (+ paths) or
Dynamic. Layout: `Page.layout` (camelCase); `Page.Layout` class only if earned.

## Codegen (invisible)

- Vite plugin (`hyperlink-ts/vite`): watch `pages/**`, atomic `paths.gen.ts`
- `hyp … --check` in CI
- Soft-nav: existing `Router/waku`; file table → host registration internally (Waku today; optional later adapter — not a static/dynamic API)

## Landed (this branch)

- `hyperlink-ts/ui/Page` — `static` / `dynamic` / `build` / `layout` (+ `Render` tagged enum)
- `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem`
- `hyperlink-ts/vite` — `fileRouter({ pagesDir, outFile })` watch + atomic emit
- `hyp file-router emit|check`

## Docs

- Guide + demo: [`docs/guides/file-router.md`](../guides/file-router.md) ·
  `pnpm run example:ui-file-router-codegen`
- Dream Page marks: [`docs/examples/ui/ui-file-router-dream.md`](../examples/ui/ui-file-router-dream.md)

## Still open

1. **`Page.Service` + Layout** — design plan (not locked): [`page-layout-design.md`](./page-layout-design.md) (includes Layout-as-View default Component + provide-swap lean)
2. Optional docs-site host-adapter cutover — maps locked marks; static/dynamic already locked via `Page.make` / `Page.static`
3. Wire docs `waku.config.ts` to `fileRouter` plugin (optional dogfood)
