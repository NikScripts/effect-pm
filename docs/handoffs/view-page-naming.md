# View / Page naming — skins, Page.Service, file router

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** owner direction — not Eng’d

## What “skin” meant (and why it’s a bad word)

In View/Dashboard code, **skin** was informal for:

> the **React (or Ink) component** you `View.provide(Tag, impl)` — i.e. the Layer that
> *implements* a View Tag’s service.

Same Tag identity; web vs TUI = different provide Layer. That seam is correct.
The **name** is not: “skin” sounds like theming/CSS, and we also said “Router skin”
for the docs-site adapter module — a second meaning.

| Old slang | What it actually is | Better names |
|-----------|---------------------|--------------|
| `skins` / `provides` / `DashboardLayer.*` / platform `DashboardViews` | `Layer` of `View.provide(Tag, Comp)` | **`componentsLayer`** on `web\|tui/Dashboard` |
| “provide a skin” | `View.provide` / `Tag.provide` | just **provide** (Effect vocabulary) |
| Docs “Router skin” | App module wrapping Waku layer | **adapter** / **site Router module** — never “skin” |

**Recommendation:** **one** `ui/DashboardViews` (contributions only). Platform
TSX + ready `layer` live on `web|tui/Dashboard` — never a second
`DashboardViews`. Compose with `Layer.provideMerge`. Keep verb `View.provide`.

```ts
import * as Dashboard from "hyperlink-ts/web/Dashboard"
Layer.mergeAll(DashboardViews.layer, appViews).pipe(
  Layer.provideMerge(Dashboard.componentsLayer),
  Layer.provideMerge(View.base),
)
```

## `View.Page.Service` is the wrong shape

Triple nest (`View` · `Page` · `Tag`) is noisy and collides two ideas:

| Today `View.Page` | File-router **Page** we want |
|-------------------|------------------------------|
| Dashboard **size chrome** (Card / Detail / **Page**) | Route module: path + Static/Dynamic/Build + metadata |
| Matched into a shell slot | File default export the router loads |
| `View.Page.Service<Self>()("key", { spec })` | Needs path, render, paths Effect, title, … |

So: **do not** mint file routes as `View.Page.Service`.

### Preferred API direction

**`Page.Service`** (own module / namespace) — file-router page identity + metadata.
Helpers for bare components stay camelCase on `Page` or `View`:

```ts
import * as Page from "hyperlink-ts/ui/Page"

class DocsChapter extends Page.Service<DocsChapter, { chapter: string }>()(
  "app/page/docs-chapter",
  {
    path: "/docs/:chapter",
    render: Page.Render.Build(),  // or owned Static | Dynamic | Build
    title: "Docs",
    paths: listChapterSlugs,      // Effect
  },
) {}

export default Page.build(DocsChapter)
// escape hatch: Page.dynamic("/search", SearchView)
// layout: Page.layout("/", BookChrome)   // camelCase helper; Layout class later if earned
```

Alternative if we insist on View umbrella: **`View.Page`** as the mint
(`class X extends View.Page<X>()("key", statics)`) — **not** `View.Page.Service`.
Still rename dashboard size chrome so “Page” isn’t two products (e.g. keep
`View.Page` = size only **or** move size to `View.Size.Page` / `ViewKind.Page` only).

**Owner lean (this note):** file routing is the priority → **`Page.Service`** +
`Page.static` / `.dynamic` / `.build` / `.layout`. Dashboard size chrome keeps
`View.Card` / `View.Detail` / size-`Page` under View, named so it doesn’t read as
a file route.

## Why Static / Dynamic Page exists

Half the point is **file-based routing + codegen**:

- Codegen/watch → typed path union from `pages/**`
- Each module’s `Page.*` mark → render mode + `paths` for SSG
- Catalog / `Route.fileRoot` → typed `urls.*`
- Soft-nav stays Router; engine wire (`createPages`) stays internal

`Page.Service` is still unfinished: statics schema, `Page.build(Tag)` reading class
bag, param Schema, layout class-or-helper, rename off `skins`, cutover from
`View.Page.Service` examples in the dream file.

## Open

1. ~~Public rename off `skins` / Domain.provide / `DashboardLayer` / triple `DashboardViews`~~ — Eng’d as one `ui/DashboardViews` + `web|tui/Dashboard.componentsLayer`
2. New `Page` module vs hang helpers on `View` — `ui/Page` helpers Eng’d; `Page.Service` deferred
3. Disambiguate dashboard size-`Page` naming when `Page.Service` lands
4. Finish `Page.Service` statics + file-router loader contract
