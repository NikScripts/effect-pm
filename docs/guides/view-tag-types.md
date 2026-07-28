{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class. Mint it from size chrome (`Card` / `Detail` / `Page`), write the
skin, export `layer`. Same shape as Effect’s `Context.Service`.

## How `Card` / `Detail` / `Page` are created

Size is a type requirement — `WithSize` / `WithSize<"card">` — then a Prototype
carries the narrowed literal. Shared base: `SizedPrototype<ViewProps, WithSize>`
(`size: "card" | "detail" | "page"`). Shipped add-ons narrow that:

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

// Same construction as the shipped add-ons:
const Card = View.Prototype<View.ViewProps>()({
  size: "card" as const,
})
const Detail = View.Prototype<View.ViewProps>()({
  size: "detail" as const,
})
const Page = View.Prototype<View.ViewProps>()({
  size: "page" as const,
})

// Prefer View.Card / View.Detail / View.Page — then mint Tags:
class MyCard extends View.Card.Tag<MyCard>()("app/view/my-card") {}
class MyDetail extends View.Detail.Tag<MyDetail>()("app/view/my-detail") {}
class MyPage extends View.Page.Tag<MyPage>()("app/view/my-page") {}

MyCard.size
//         ^?
MyDetail.size
//           ^?
MyPage.size
//         ^?
```

## Card + Detail + Page + `layer`

Shipped modules stamp a `spec` on each sized Prototype, mint classes, provide skins,
export `layer` (not `*Live`) — same pattern as
[`WorkPoolView.ts`](../../src/ui/WorkPoolView.ts):

{.twoslash}
``` ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"

const CardProto = View.Card.Prototype()({
  spec: { kind: "app/queue" } as const,
})
const DetailProto = View.Detail.Prototype()({
  spec: { kind: "app/queue" } as const,
})
const PageProto = View.Page.Prototype()({
  spec: { kind: "app/queue" } as const,
})

class PoolCard extends CardProto.Tag<PoolCard>()(
  "app/view/pool-card",
) {}
class PoolDetail extends DetailProto.Tag<PoolDetail>()(
  "app/view/pool-detail",
) {}
class PoolPage extends PageProto.Tag<PoolPage>()(
  "app/view/pool-page",
) {}

const PoolCardView: PoolCard["Service"] = (props) => {
  props
  // ^?
  return null
}
const PoolDetailView: PoolDetail["Service"] = (_props) => null
const PoolPageView: PoolPage["Service"] = (_props) => null

export const layer = Layer.mergeAll(
  Layer.succeed(PoolCard, PoolCardView),
  Layer.succeed(PoolDetail, PoolDetailView),
  Layer.succeed(PoolPage, PoolPageView),
)
```

Annotate skins with **`PoolCard["Service"]`** (no `typeof`).
`props` is `View.ViewProps` (`tag`, optional `name`).

## Extra props on a sized Prototype

Accumulate props, then mint the class — same as
[`worker-pool-card.tsx`](../../examples/hyperlink-web/worker-pool-card.tsx):

{.twoslash}
``` ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"

type Extra = { readonly dense?: boolean }

const Proto = View.Card.Prototype<Extra>()({
  spec: { kind: "app/dense-card" } as const,
})

class DenseCard extends Proto.Tag<DenseCard>()(
  "app/view/dense-card",
) {}

const DenseCardView: DenseCard["Service"] = (props) => {
  props
  // ^?
  return null
}

export const layer = Layer.succeed(DenseCard, DenseCardView)
```

`props` is `View.ViewProps & { dense?: boolean }`.

## Wire into Dashboard

Allowlist + skin (`R = View.Registry`; Dashboard closes with `View.base`):

```ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"
import { WorkerPool } from "./hub"

const Proto = View.Card.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "examples/worker-pool-card" } as const,
})

export class WorkerPoolCard extends Proto.Tag<WorkerPoolCard>()(
  "examples/hyperlink-web/worker-pool-card",
) {}

const WorkerPoolCardView: WorkerPoolCard["Service"] = (props) => null

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)
```

Full dogfood: [`examples/hyperlink-web/worker-pool-card.tsx`](../../examples/hyperlink-web/worker-pool-card.tsx).
