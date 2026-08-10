# Last.provider (owner lock)

**Status:** LOCK + Eng’d on `cursor/agent-k-page-route-6d0e`  
**Package:** `last-ts` (`Last.provider`)  
**Related:** [`page-document-lock.md`](./page-document-lock.md) · [`page-layout-lock.md`](./page-layout-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**Bake one fulfilled Layer into one children-only React provider — `Last.provider(layer)`. No nested product providers.**

## Recipe

```ts
import { Layer, pipe } from "effect"
import * as Last from "last-ts/Last"
import * as Waku from "last-ts/Waku"
import * as Document from "last-ts/Document"
import { routes } from "./site"
import { siteDocumentLayer } from "./document"

export const Provider = Last.provider(
  pipe(
    Waku.layer,                 // soft-nav transport
    Layer.provide(routes),      // catalog + Layout.provide
    Layer.provide(siteDocumentLayer), // Document.Cell
  ),
)
// <Provider>…</Provider>
```

Prefer `pipe(layer, Layer.provide(…))` over long `.pipe` chains.

## What goes in the Layer

| Piece | How |
|-------|-----|
| Soft-nav transport | `Waku.layer` / `History.layer` / `Memory.layer` |
| Routes | `RouterBuilder.layer` + group handlers + `Layout.provide` |
| Document | `Document.provide(Doc, Document.title(…), Document.titleTransform(…), …)` |

`Last.provider` wraps `Document.FieldsProvider` when `Document.Cell` is present.

## Forbidden

- Teaching extra `RegistryProvider` / nested soft-nav providers as the product path
- Baking incomplete Document (missing `title` / `titleTransform`) — type error via `Document.provide`
- App `import` from `waku`

## Dogfood

- Last site: `docs/last/site/src/lib/Provider.tsx`
- Spine walkthrough: [`last-ts-spine.md`](./last-ts-spine.md)
