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

## Page mark — `View.static` / `View.dynamic` / `View.build` (locked)

**Not** named functions, **not** Waku `getConfig`, **not** JSX wrappers for SSG mode.
Path string is the key; pass the component (or prefer a page **class**).

Values are camelCase (helpers). Prefer a **class** page when metadata / DI matter.

```ts
// Bare component — helper (camelCase)
export default View.dynamic("/docs/:chapter", Chapter)
export default View.static("/about", About)
export default View.build("/docs/:chapter", Chapter, {
  paths: () => chapters.map((c) => c.slug),
})

// Preferred — page class (PascalCase Tag-shaped), metadata on the class
class DocsChapter extends View.Page.Tag<DocsChapter, ChapterProps>()(
  "app/page/docs-chapter",
  {
    path: "/docs/:chapter",
    render: "build", // or static | dynamic — owned discriminant PascalCase
    // …title, crumbs, og, … see Metadata
  },
) {}
export default View.build(DocsChapter) // path/render/paths from class statics
```

| Form | When |
|------|------|
| `View.dynamic(path, Comp)` | Page is just a component — no class yet |
| `View.static` / `View.build` | Same, other render modes |
| Page **class** | Preferred — room for metadata, nested `View.Tag`, Layer skins |

Default when unmarked: **static** (fixed paths). Param routes must mark
`build` (+ `paths`) or `dynamic` — fail loud if missing.

`View.static` / `.dynamic` / `.build` stamp module metadata the file-router
reads at load → internal `createPages({ render, staticPaths })`. Apps never
see Waku’s shape.

**No** Layer-shaped deps on the page mark — pass the component. Need DI inside
the page → nest normal `View.Tag` + `View.provide` (Layer `R` stacks as usual).

## Metadata (where it lives)

Pages need more than render mode (title, description, crumbs, OG, …).

| Home | Use |
|------|-----|
| **Page class statics** (preferred) | SSOT next to path/render — same bag as `View.*.Tag` statics |
| Options on `View.build(path, Comp, opts)` | Bare-component escape hatch |
| Not a second sidecar file per route | Avoid drift |

Exact schema TBD at Eng; keep it Schema-first and optional fields.

## `View.layout` (planned)

Waku/file layouts (`_layout.tsx`) need a Hyperlink mark too.

- **Value helper (camelCase):** `View.layout(path, LayoutComp)` — default until we
  need class semantics.
- **Class later if useful:** `View.Layout` (PascalCase) only if it earns Tag-like
  metadata / provide — same bar as preferring page classes.

Layouts share render defaults with pages (unmarked → static) unless marked
dynamic.

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
