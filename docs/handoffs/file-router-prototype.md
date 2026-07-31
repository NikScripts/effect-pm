# File-router prototype

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** prototype — typed path union verified; not on package exports

## Question

Can we own file-based routing (instead of Waku fs-router) with **fully typed**
file paths as a union?

## Answer

**Yes — with a small codegen (or Vite plugin that writes the same file).**

TypeScript cannot discover filesystem paths at typecheck time. Bare
`import.meta.glob` keys type as `string`. Emit `paths.gen.ts` from a pages walk
and you get a closed union:

```ts
export type FilePath = "/" | "/api/[pkg]" | "/docs/[chapter]" | "/search"
export type RoutePath = "/" | "/api/:pkg" | "/docs/:chapter" | "/search"
```

Proof: `test/ui-file-router-proto.test-d.ts` + `examples/ui/file-router/`.

Disk uses `[param]` (familiar file templates); Hyperlink `Route` keeps `:param`.
The adapter translates.

## Dream API (owner)

```ts
Route.group("docs").fromEffect(Router.fileSystem("./pages/docs", opts?))
Route.fileSystem("root", "/", { topLevel: true, dir: "./pages" })
Route.fileRoot()                 // root + "/" + topLevel
Route.fileRoot({ dir: "./pages", render: "build", … })
```

Sketched in `examples/ui/file-router/api.ts` (`fileSystem` / `fileRoot` /
`protoSite` + typed `urlBuilder`).

## Relation to Waku

- We do **not** use Waku’s fs-router / public `getConfig`.
- Production path: our typed file table → Waku `createPages` internally
  (`render` / `staticPaths` stay behind the overlay).
- Soft-nav stays `hyperlink-ts/ui/Router/waku`.

## Untyped fallback

If codegen is declined, `Router.fileSystem` can still return destinations with
`path: string` — useful, but UrlBuilder loses literal ids/params. Prefer typed.

## Next Eng (owner-gated)

1. Vite/`hyp` watch plugin for `paths.gen.ts`
2. Public `Router.fileSystem` + `Route.fileRoot` (+ changeset)
3. Docs-site cutover off Waku fs-router onto our adapter → `createPages`
4. Render overlay (`page.static` / `page.build`) on the same table
