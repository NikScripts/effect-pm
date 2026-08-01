# File-router prototype

Hyperlink-owned file router (not Waku `fs-router`). Proves we can get a **typed
path union** from a pages tree via a small codegen emit.

## Typed union — yes, with codegen

TypeScript cannot glob the filesystem at typecheck time. `import.meta.glob`
keys also collapse to `string` without a typegen plugin.

This prototype walks `fixtures/pages` and emits `paths.gen.ts`:

```ts
export type FilePath = "/" | "/api/[pkg]" | "/docs/[chapter]" | "/search"
export type RoutePath = "/" | "/api/:pkg" | "/docs/:chapter" | "/search"
```

`[param]` on disk → `:param` for Hyperlink `Route` templates.

```bash
node examples/ui/file-router/scripts/gen-paths.mjs
```

Lock: `test/ui-file-router-proto.test-d.ts` (via `src/ui/tsconfig.json`).

## Dream API (sketched in `api.ts`)

```ts
Route.group("docs").fromEffect(Router.fileSystem("./pages/docs"))
Route.fileSystem("root", "/", { topLevel: true, dir: "./pages" })
Route.fileRoot()                      // ≡ id root + "/" + topLevel
Route.fileRoot({ dir: "./pages" })
```

Not on package exports yet — compose proof only:

```ts
Route.make("app").add(fileRoot())
// urls.index() / urls.docs_chapter("routing") / …
```

## Next (when Eng’d)

1. Vite (or `hyp`) plugin that regenerates `paths.gen.ts` on file add/remove
2. Land `Router.fileSystem` / `Route.fileRoot` on public modules
3. Docs-site adapter: our file router → Waku `createPages` (no public `getConfig`)
4. Optional: `page.static` / `page.build` render overlay per file
