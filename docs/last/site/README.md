# last.ts docs server

Official Waku RSC surface for **last.ts** (`docs/last/site`).

Not Hyperlink `docs/site`. Not an example app.

| | |
|---|---|
| Run | `pnpm run docs:last-site` → `:5220` |
| Pages | `Page.make` / `Page.static` classes + `Page.asDefault` |
| Soft-nav | `export const Provider = Last.provider(Waku.layer.pipe(Layer.provide(routes)))` |
