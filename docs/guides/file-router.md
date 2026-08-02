{#file-router title="File router" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/file-router>.
<!-- docs-site-link:end -->
# File router

{.draft}
**Draft** — path-table codegen + Vite plugin are Eng’d; docs-site cutover off Waku
`getConfig` / `Page.Tag` still open. Soft-nav stays on [Routing](/docs/routing).

Hyperlink owns a **typed path table** for file-based routes: walk `pages/**`,
emit `paths.gen.ts`, feed `Route.fileRoot` so `urls.*` is a closed builder — not
`string` hrefs from `import.meta.glob`.

```text
pages/**  →  paths.gen.ts (FilePath | RoutePath | ids)
          →  Route.fileRoot(fileEntries) → urls.docs_chapter("routing")
```

Disk keeps `[param]`; Hyperlink `Route` keeps `:param`. The emitter translates.

## Demo — closed unions

Fixture tree: `examples/ui/file-router/fixtures/pages`  
Generated: [`paths.gen.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/file-router/paths.gen.ts)  
Run: `pnpm run example:ui-file-router-codegen`

{.twoslash include="examples/ui/file-router/codegen-demo.ts"}
``` ts
```

Type lock (wrong paths are compile errors):
`test/ui-file-router-proto.test-d.ts`.

```ts
type FilePath = "/" | "/api/[pkg]" | "/docs/[chapter]" | "/search"
type RoutePath = "/" | "/api/:pkg" | "/docs/:chapter" | "/search"
type FileRouteId = "index" | "api_pkg" | "docs_chapter" | "search"
```

```ts
import * as Route from "hyperlink-ts/ui/Route"
import { fileEntries } from "./paths.gen"

const site = Route.make("app").add(Route.fileRoot(fileEntries))
const urls = Route.urlBuilder(site)

urls.index()                 // "/"
urls.docs_chapter("routing") // "/docs/routing"
urls.api_pkg("effect")       // "/api/effect"
// urls.nope()               // type error — id not in the table
```

## Is it plugged into Vite?

**Yes — as an opt-in plugin** exported from `hyperlink-ts/vite`. Add it to your
Vite (or Waku) config; it is **not** auto-injected and the docs site does not
dogfood it yet (still Waku `pages.gen` + `getConfig`).

```ts
// vite.config.ts / waku.config.ts
import { defineConfig } from "vite" // or Waku’s defineConfig
import { fileRouter } from "hyperlink-ts/vite"

export default defineConfig({
  plugins: [
    fileRouter({
      pagesDir: "src/pages",
      outFile: "src/paths.gen.ts",
    }),
  ],
})
```

| Hook | Behavior |
|------|----------|
| `buildStart` | Emit (or `check: true` → fail if dirty) |
| `configureServer` | Emit once, then watch `pages/**` (add/unlink/change) |
| Write | Atomic temp + rename |

Same emit for CI / scripts:

```bash
hyp file-router emit --pages src/pages --out src/paths.gen.ts
hyp file-router check --pages src/pages --out src/paths.gen.ts
```

## API surface

| Piece | Import | Job |
|-------|--------|-----|
| Plugin | `hyperlink-ts/vite` → `fileRouter` | Watch + emit `paths.gen.ts` |
| Emit/check helpers | `hyperlink-ts/vite` → `emitPaths` / `checkPaths` / `discover` | Programmatic / tests |
| CLI | `hyp file-router emit\|check` | Local + CI |
| Catalog | `Route.fileRoot` / `Route.fileSystem` / `Router.fileSystem` | Table → destinations |
| Page marks | `hyperlink-ts/ui/Page` → `static` / `dynamic` / `build` / `layout` | Render mode stamp (loader → `createPages` still open) |

```ts
import * as Route from "hyperlink-ts/ui/Route"
import * as Router from "hyperlink-ts/ui/Router"
import { fileEntries } from "./paths.gen"

// Common case — flatten onto UrlBuilder
Route.make("app").add(Route.fileRoot(fileEntries))

// Named group
Route.make("app").add(Route.fileSystem("docs", fileEntries))

// Same table via Router helper
Route.group("root", { topLevel: true }).fromEffect(
  Router.fileSystem(fileEntries),
)
```

`fileRouter` options:

```ts
type FileRouterPluginOptions = {
  readonly pagesDir: string  // walk root
  readonly outFile: string   // generated module
  readonly check?: boolean   // buildStart fails if emit would change outFile
}
```

Generated module shape (do not hand-edit):

```ts
export const fileEntries = [ /* { id, filePath, routePath } */ ] as const
export const filePaths = [ /* … */ ] as const
export const routePaths = [ /* … */ ] as const
export type FilePath = /* union of filePaths */
export type RoutePath = /* union of routePaths */
export type FileRouteId = /* union of ids */
```

Page marks (separate from the path table — stamp the default export):

```ts
import * as Page from "hyperlink-ts/ui/Page"

export default Page.build("/docs/:chapter", ChapterView, {
  paths: listChapterSlugs, // Effect
})
```

## Good DX whether or not codegen is “working”

TypeScript cannot glob the filesystem into a closed union. The gen file **is**
the type source. Design for three states:

| State | What you want |
|-------|----------------|
| Fresh clone, no Vite yet | Editor + `tsc` still see real unions |
| `vite` / `waku` dev | Gen stays aligned as files appear/disappear |
| CI | Fail if someone committed a stale or missing table |

**Contract we ship:**

1. **Commit `paths.gen.ts`.** Clone and typecheck work cold — you do not need
   Vite running to open the project. Treat the file as generated *and* checked in
   (like many GraphQL / Prisma clients).
2. **Vite plugin is the happy path in dev.** `buildStart` + watcher rewrite the
   file; no manual emit while iterating on `pages/**`.
3. **`hyp file-router check` in CI.** Same bytes as emit; fails with
   `PathsMissingError` / `PathsStaleError` if dirty. Optional:
   `fileRouter({ check: true })` on `buildStart` for the same gate in Vite builds.
4. **Never widen to `string`.** Empty pages tree → union `never` (loud). Unknown
   path / id → type error. That is better than silently accepting any href.
5. **Escape hatch without the file router.** Hand-write `Route.get` / groups —
   soft-nav does not require codegen. Skip the plugin when the catalog is small
   and stable.

**If emit is broken or skipped:**

- Committed gen still typechecks last-known tree (edit pages → types lag until
  emit/check; CI catches the lag).
- Delete the gen file without regenerating → import fails loudly (fixable), not
  a silent `string` fallback.
- Offline / no Node FS → use the committed file; run `hyp file-router emit` when
  you can.

**Still open (honest gaps):**

- Docs site not on this plugin yet (Waku `getConfig` + its own `pages.gen`).
- No loader yet that reads `Page.stampOf` → Waku `createPages`.
- `Page.Tag` class mint deferred — helpers only.

## Related

- [Routing](/docs/routing) — catalog, Router layers, GroupNav
- [File-router dream API](/docs/ui-file-router-dream) — Page mark teaching sketch
- Handoff: [`file-router-prototype.md`](../handoffs/file-router-prototype.md)
