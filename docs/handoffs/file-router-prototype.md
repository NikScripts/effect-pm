# File-router prototype

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** prototype — typed path union verified; page mark / layout design locked below  
**Naming:** Layers are always **camelCase** — already `.must` in
[`types-and-naming.md`](../standards/types-and-naming.md#layers-read-as-layers)
(`layer`, `layerMemory`, `skins`, `peersLayer`, …). No PascalCase layer values.

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

## Page mark — `Page.*` + `Page.Tag` (locked direction)

Naming detail: [`view-page-naming.md`](./view-page-naming.md) — **not**
`View.Page.Tag` (collides with dashboard size chrome). Kill the word **skin**;
use **`provides`**.

Static/Dynamic/Build exist largely **because** file routing + codegen are
priorities: mark on the module → engine registration; codegen → typed paths.

```ts
import * as Page from "hyperlink-ts/ui/Page"

export default Page.dynamic("/search", SearchView)
export default Page.build("/docs/:chapter", ChapterView, {
  paths: listChapterSlugs, // Effect
})

class DocsChapter extends Page.Tag<DocsChapter, ChapterProps>()(
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

`Page.Tag` still needs work (statics schema, `Page.build(Tag)`, param Schema, …).

Default unmarked fixed path → Static. Param routes must mark Build (+ paths) or
Dynamic. Layout: `Page.layout` (camelCase); `Page.Layout` class only if earned.

## Codegen (invisible)

- Vite plugin (`hyperlink-ts/vite`): watch `pages/**`, atomic `paths.gen.ts`
- `hyp … --check` in CI
- Soft-nav: existing `Router/waku`; file table → `createPages` internally

## Next Eng

1. Plugin + emit + `--check`
2. Public `Router.fileSystem` / `Route.fileRoot`
3. `View.static` / `View.dynamic` / `View.build` (+ page-class path)
4. Metadata schema on page statics
5. `View.layout`
6. Docs-site cutover off Waku fs-router
