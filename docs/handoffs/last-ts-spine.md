# last-ts spine (canonical walkthrough)

**Status:** teaching SSOT for the Eng’d stack on `cursor/agent-k-page-route-6d0e`  
**Acceptance demo (package bar):** [`examples/last/spine`](../../examples/last/spine/) — finish this before growing Last site / Hyperlink  
**Context `fromEffect` showcase:** [`examples/last/from-effect/Catalog.ts`](../../examples/last/from-effect/Catalog.ts) — `Catalog` class → typed `Urls` + Layer-swapped Acme/Globex  
**Twoslash (docs site):** fences include [`src/`](../../examples/last/spine/src/) · [`docs/examples/last/last-ts-spine.md`](../examples/last/last-ts-spine.md) → `/docs/last-ts-spine`  
**Later dogfood:** [`docs/last/site`](../last/site/) · Hyperlink [`docs/site`](../site/)

## One path

```text
Page.make / Page.static     →  body + bake mode (no path on mint)
file under pages/**         →  URL path (fileRouter → paths.gen)
Router.make + Route.get     →  soft-nav catalog + urls.*
RouterBuilder.handle(mint)  →  catalog handlers (unwraps .default)
Layout.provide(…)           →  page-group layout debt
RootLayout.make / Default   →  one html root (Context.Reference)
Document.provide(…)         →  Document.Cell (title + titleTransform)
Last.provider(layer)        →  one children-only React provider
```

**Not product / never teach in apps:** Waku `createPages` / `createRoot` / `createLayout` /
`createPage`, `waku.server.tsx`, hand-rolled `_root.tsx`. That is host-engine glue
(re-exported by mistake as `last-ts/server`). Product APIs above already cover the surface.

## Minimal site

### 1. Page (file owns path)

```ts
// pages/guides/[slug].tsx
export class Chapter extends Page.static(
  { params: { slug: Schema.Literals(["routing", "view-service"]) } },
  (props: { readonly params: { readonly slug: string } }) => (
    <h1>{props.params.slug}</h1>
  ),
) {}
```

### 2. Soft-nav catalog

```ts
export class Site extends Router.make("app").add(
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  }),
) {}

export const urls = Route.urlBuilder(Site)

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) => h.handle("guides_slug", Chapter)),
  Layout.provide(Layout.Passthrough),
)
export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app))
```

### 3. Document + provider

```ts
export const siteDocumentLayer = Document.provide(
  SiteDocument,
  Document.title("last.ts"),
  Document.titleTransform((t) => (t === "last.ts" ? t : `${t} · last.ts`)),
)

export const Provider = Last.provider(
  pipe(
    Waku.layer, // or History.layer / Memory.layer — transport swap only
    Layer.provide(routes),
    Layer.provideMerge(siteDocumentLayer), // Cell must stay in output
  ),
)
```

### 4. Root layout

One `RootLayout` Reference — package `Default` is `RootLayout.make(…)`, same as a custom root.
Override via Layer on the Reference. No second “Root” component. No `_root.tsx`.

## Locks

| Concern | Lock |
|---------|------|
| Corrections / host boundary | [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) |
| Page mint | [`page-mint-lock.md`](./page-mint-lock.md) |
| Document | [`page-document-lock.md`](./page-document-lock.md) |
| Layout | [`page-layout-lock.md`](./page-layout-lock.md) |
| Provider | [`last-provider-lock.md`](./last-provider-lock.md) |
| File router | [`file-router-lock.md`](./file-router-lock.md) |
| HttpApi Router | [`router-httpapi-lock.md`](./router-httpapi-lock.md) |

## Forbidden (never teach)

`import` from `waku` · `getConfig` · `pageConfig` · `Page.asDefault` · path on `Page.make` ·
catalog-merge `*FromPages` · nested product providers · app `createPages` / `createRoot` /
`createLayout` / `waku.server.tsx` · `RootLayout.Default.Component` wrappers
