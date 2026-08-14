# Last.provider (owner lock)

**Status:** LOCK + Eng’d on `cursor/agent-k-page-route-6d0e`  
**Package:** `last-ts` (`Last.provider`)  
**Related:** [`page-document-lock.md`](./page-document-lock.md) · [`page-layout-lock.md`](./page-layout-lock.md) · [`router-httpapi-lock.md`](./router-httpapi-lock.md)

## One-sentence lock

**Bake one fulfilled Layer into one children-only React provider — `Last.provider(layer)`. That is the page entry point.**

Provide hygiene (where to provide, when to nest a scope, lifetimes): [`docs/standards/effect-style.md`](../standards/effect-style.md) — *provide-at-entry-points*, *nest-provide-for-scope*, *provide-site-sets-lifetime*, *web-page-entry-point*. Do **not** invent a second product provider zoo (`RegistryProvider` taught as app API, soft-nav wrappers as separate product paths). Nesting a **new scope bag** under the one bake (router context, etc.) is allowed when `R` / lifetime differs — same as Effect.

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
    Waku.layer,                        // soft-nav transport
    Layer.provide(routes),             // catalog + Layout.provide
    Layer.provideMerge(siteDocumentLayer), // Document.Cell (must stay in output)
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
| Document | `Document.provide(…)` merged with **`Layer.provideMerge`** so `Document.Cell` remains in the Layer output (plain `Layer.provide` drops it) |

`Last.provider` wraps `Document.FieldsProvider` when `Document.Cell` is present.

## Forbidden

- Teaching extra `RegistryProvider` / nested soft-nav providers as the product path
- Baking incomplete Document (missing `title` / `titleTransform`) — type error via `Document.provide`
- App `import` from `waku`

## Dogfood

- Last site: `docs/last/site/src/lib/Provider.tsx`
- Spine walkthrough: [`last-ts-spine.md`](./last-ts-spine.md)
