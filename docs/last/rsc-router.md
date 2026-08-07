{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> Live demo (Tailscale): <http://100.67.32.32:5220/>  
> Source: [`examples/apps/last-ts-site`](https://github.com/nikolasstow/Hyperlink/tree/integration/examples/apps/last-ts-site)  
> Run: `pnpm run example:apps-last-ts-site`
<!-- docs-site-link:end -->
# RSC + Router

How **last.ts** wires a Waku RSC app: file pages own render, the Router catalog
owns typed urls + soft-nav. This is the runnable demo under
`examples/apps/last-ts-site` — fences below are that code.

## Split of jobs

| Layer | Job |
|-------|-----|
| `src/pages/**` | **RSC render** (Waku file routes) |
| `Router.make` catalog + `Route.urlBuilder` | Typed destinations / `urls.*` |
| `Last.provider(Waku.fromApi(Site))` | Soft-nav provider (children only) |
| Client islands (`View.Service`, …) | Interactive DI inside an RSC page |

**Not** used for page bodies here: `RouterBuilder` + `Router.Outlet` + Memory /
History. Those are for SPA / in-process catalogs. RSC file routes stay the
document SSOT; `Outlet` would fight Waku.

```text
URL  →  Waku file page (RSC)           ← render
urls →  Router.make catalog            ← typed hrefs
Link →  Last.provider(Waku.fromApi(…)) ← soft-nav
```

`Page.Service` / `createPages` (stamp → engine) is not Eng’d yet. Until then,
pages are ordinary Waku modules — **no** `Page.getConfig`, **no** Stamped
default-export theater. Param SSG still needs Waku’s own `getConfig` /
`staticPaths` on that one file (engine wire, not a last-ts API).

## 1. Catalog — `Router.make`

Top-level group so `urls.home()` is flat (not `urls.app.home()`).

{.twoslash include="examples/apps/last-ts-site/src/lib/site.ts"}
``` ts
```

## 2. Provider — `Last.provider` + `Waku.fromApi`

Bake the catalog into a children-only provider. Mount once in the layout.

Wrong (do not copy):

```ts
// 1. Last.app is deprecated
// 2. Layer.empty is fake debt
// 3. Waku.router pipe is the deprecated install path
// 4. Waku.waku is a binding, not the Layer
// 5. Peeling .Provider — Last.provider already returns the component
const Provider = Last.app(Layer.empty).pipe(
  Waku.router(Waku.waku(Site)),
).Provider
```

Right:

{.twoslash include="examples/apps/last-ts-site/src/islands/provider.tsx"}
``` tsx
```

For SPA / Outlet trees use `Waku.layer.pipe(Layer.provide(routes))` instead of
`fromApi`.

## 3. Soft-nav — `Link` from `last-ts/Waku`

Client island. Prefer string `to` values from `urls` when the caller is near
RSC (function builders are fine in client components).

{.twoslash include="examples/apps/last-ts-site/src/islands/Nav.tsx"}
``` tsx
```

## 4. Layout — mount `provider` directly

No wrapper component around the provider. Alias for JSX capitalization only.

{.twoslash include="examples/apps/last-ts-site/src/pages/_layout.tsx"}
``` tsx
```

## 5. Pages — plain Waku RSC modules

Home:

{.twoslash include="examples/apps/last-ts-site/src/pages/index.tsx"}
``` tsx
```

Param guide:

{.twoslash include="examples/apps/last-ts-site/src/pages/guides/[slug].tsx"}
``` tsx
```

View page shells the interactive island (still an RSC page):

{.twoslash include="examples/apps/last-ts-site/src/pages/view.tsx"}
``` tsx
```

## 6. Island — `View.Service(key, default)`

Client-only DI demo on `/view`:

{.twoslash include="examples/apps/last-ts-site/src/islands/ViewDemo.tsx"}
``` tsx
```

## Check it

```bash
pnpm run example:apps-last-ts-site
# http://100.67.32.32:5220/
```

Click nav: URL + RSC page swap via Waku soft-nav; `/view` toggles the Sidebar
slot without remounting the book chrome.
