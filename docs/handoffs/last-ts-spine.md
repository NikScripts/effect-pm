# last-ts spine (canonical walkthrough)

**Status:** teaching SSOT for the Eng’d stack on `cursor/agent-k-page-route-6d0e`  
**Dogfood:** [`docs/last/site`](../last/site/) (reference) · Hyperlink [`docs/site`](../site/) (same host boundary)

## One path

```text
Page.make / Page.static     →  body + bake mode (no path on mint)
file under pages/**         →  URL path (fileRouter → paths.gen)
Server.fromPage(path, mint) →  host createPages (mode + prop adapt)
Router.make + Route.get     →  soft-nav catalog + urls.*
RouterBuilder.handle(mint)  →  catalog handlers (unwraps .default)
Layout.provide(…)           →  page-group layout debt
Document.provide(…)         →  Document.Cell (title + titleTransform)
Last.provider(layer)        →  one children-only React provider
```

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

### 2. Host registration

```ts
// waku.server.tsx — CLI filename; imports from last-ts/server only
createPage({
  ...Server.fromPage("/guides/[slug]", Chapter),
  staticPaths: ["routing", "view-service"],
})
```

Waku flats (`{ slug }`) → soft-nav `{ params, query, pathname, href }` inside `fromPage`.

### 3. Soft-nav catalog

```ts
export class Site extends Router.make("app").add(
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  }),
) {}

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) => h.handle("guides_slug", Chapter)),
  Layout.provide(Layout.Passthrough),
)
export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app))
```

### 4. Document + provider

```ts
export const siteDocumentLayer = Document.provide(
  SiteDocument,
  Document.title("last.ts"),
  Document.titleTransform((t) => (t === "last.ts" ? t : `${t} · last.ts`)),
)

export const Provider = Last.provider(
  pipe(Waku.layer, Layer.provide(routes), Layer.provide(siteDocumentLayer)),
)
```

### 5. Root

```tsx
export default function Root(props: { readonly children: ReactNode }) {
  return (
    <Provider>
      <RootLayout.Default.Component>{props.children}</RootLayout.Default.Component>
    </Provider>
  )
}
```

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

`import` from `waku` · `getConfig` · `pageConfig` · `Page.asDefault` · path on `Page.make` · catalog-merge `*FromPages` · nested product providers
