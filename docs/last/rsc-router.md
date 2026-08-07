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
| `src/pages/**` + `Page.static` / `build` / `layout` | **RSC render** (SSG/SSR) |
| `Router.make` catalog + `Route.urlBuilder` | Typed destinations / `urls.*` |
| `last-ts/Router/waku` | Soft-nav (`Link` / `useRouter`) over Waku |
| Client islands (`View.Service`, …) | Interactive DI inside an RSC page |

**Not** used for page bodies here: `RouterBuilder` + `Router.Outlet` + Memory /
History. Those are for SPA / in-process catalogs. RSC file routes stay the
document SSOT; `Outlet` would fight Waku.

```text
URL  →  Waku file page (RSC)     ← render
urls →  Router.make catalog      ← typed hrefs
Link →  Waku.router(waku(Site))  ← soft-nav
```

## 1. Catalog — `Router.make`

Top-level group so `urls.home()` is flat (not `urls.app.home()`).

{.twoslash include="examples/apps/last-ts-site/src/lib/site.ts"}
``` ts
```

## 2. Waku layer — `Last.app` + `Waku.router`

Bake the binding into a children-only Provider. Mount once in the layout island.

{.twoslash include="examples/apps/last-ts-site/src/islands/RouterProvider.tsx"}
``` tsx
```

## 3. Soft-nav — `Link` from `last-ts/Router/waku`

Client island. Prefer string `to` values from `urls` when the caller is near
RSC (function builders are fine in client components).

{.twoslash include="examples/apps/last-ts-site/src/islands/Nav.tsx"}
``` tsx
```

## 4. Layout — `Page.layout` + Provider

RSC layout wraps children with the Router Provider + nav island.

{.twoslash include="examples/apps/last-ts-site/src/pages/_layout.tsx"}
``` tsx
```

`Page.getConfig(Stamped)` is the temporary Waku bridge until `createPages`
reads `stampOf` directly. Stamps stay on `last-ts/Page` (RSC-safe). React
hooks for Outlet trees live on `last-ts/Page/react`.

## 5. Pages — `Page.static` / `Page.build`

Home (static RSC):

{.twoslash include="examples/apps/last-ts-site/src/pages/index.tsx"}
``` tsx
```

Param guide (build paths; dynamic in DEV):

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
