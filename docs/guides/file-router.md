{#file-router title="File router" status="stable" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/file-router>.
<!-- docs-site-link:end -->
# File router

**Lock:** [`../handoffs/file-router-lock.md`](../handoffs/file-router-lock.md) ·
**Spine:** [`../handoffs/last-ts-spine.md`](../handoffs/last-ts-spine.md)

`fileRouter` walks `pages/**` and emits a **path-only** typed table
(`paths.gen.ts`). It is not the soft-nav catalog, not host registration, and not
Page mint mode.

Apps never import `waku`. Host façades: `last-ts/config` / `last-ts/server`.
Page bodies: `Page.make` / `Page.static` (path from the file). Soft-nav:
`Router.make` + `Route.get` (hand-authored params).

```text
pages/**  →  paths.gen.ts (FilePath | RoutePath | ids)
          →  align by hand with Router.make / Server.fromPage
```

Disk keeps `[param]`; Route keeps `:param`. Organizational `(group)` segments
are stripped from the typed URL path (`(book)/docs/x` → `/docs/x`).

## Demo — closed unions

Fixture tree: `examples/ui/file-router/fixtures/pages`  
Generated: [`paths.gen.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/file-router/paths.gen.ts)  
Run: `pnpm run example:ui-file-router-codegen`

{.twoslash include="examples/ui/file-router/codegen-demo.ts"}
``` ts
```

Type lock: `test/ui-file-router-proto.test-d.ts`.

```ts
type FilePath = "/" | "/api/[pkg]" | "/docs/[chapter]" | "/search"
type RoutePath = "/" | "/api/:pkg" | "/docs/:chapter" | "/search"
type FileRouteId = "index" | "api_pkg" | "docs_chapter" | "search"
```

Optional UrlBuilder-only bridge (no params schemas — weaker than a real catalog):

```ts
import * as Route from "last-ts/Route"
import { fileEntries } from "./paths.gen"

const site = Route.make("app").add(Route.fileRoot(fileEntries))
const urls = Route.urlBuilder(site)

urls.index()                 // "/"
urls.docs_chapter("routing") // "/docs/routing"
```

Product catalogs with `params` stay hand-written (see Last / Hyperlink dogfood).

## Vite plugin

```ts
// waku.config.ts — CLI filename only
import * as Config from "last-ts/config"
import * as Vite from "last-ts/vite"

export default Config.defineConfig({
  vite: {
    plugins: [
      Vite.fileRouter({
        pagesDir: "src/pages",
        outFile: "src/paths.gen.ts",
      }),
    ],
  },
})
```

| Hook | Behavior |
|------|----------|
| `buildStart` | Emit (or `check: true` → fail if dirty) |
| `configureServer` | Emit once, then watch `pages/**` |
| Write | Atomic temp + rename |

```bash
hyp file-router emit --pages src/pages --out src/paths.gen.ts
hyp file-router check --pages src/pages --out src/paths.gen.ts
```

`hyp verify` checks Last site + Hyperlink `docs/site` gens.

## Generated module (do not hand-edit)

```ts
export const fileEntries = [ /* { id, filePath, routePath } */ ] as const
export const filePaths = [ /* … */ ] as const
export const routePaths = [ /* … */ ] as const
export type FilePath = /* union of filePaths */
export type RoutePath = /* union of routePaths */
export type FileRouteId = /* union of ids */
```

## Contract

1. **Commit `paths.gen.ts`.** Cold typecheck works without Vite.
2. **Vite plugin** keeps gen aligned in dev.
3. **`hyp file-router check` in CI** (`PathsMissingError` / `PathsStaleError`).
4. **Never widen to `string`.** Empty tree → `never`.
5. **Catalog / host stay hand-authored.** No auto-merge from gen into `Router.make` or `createPages`.

## Related

- [Routing](/docs/routing) — catalog, Router layers
- Spine: [`last-ts-spine.md`](../handoffs/last-ts-spine.md)
- Lock: [`file-router-lock.md`](../handoffs/file-router-lock.md)
