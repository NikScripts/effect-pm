{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class. Mint it from size chrome, write the skin, export `layer`.
Same shape as Effect’s `Context.Service`.

## Requirement (R-style)

`Prototype<Props, Requirement>` carries a **debt**. Declare it open, chain steps,
then fulfill — Requirement discharges to `{}` (like Effect `R → never`).

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

// Open — WithSize unpaid
const Open = View.SizeChrome
// Prefer View.SizeChrome, or:
// View.Prototype<View.ViewProps, View.WithSize>()()

// Chain while open (props + statics, additive)
const Mid = Open.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
})

// Fulfill last — PascalCase tagged size (`Data.TaggedEnum`)
const Proto = Mid.Prototype()({ size: View.ViewKind.Card() })

class PoolCard extends Proto.Tag<PoolCard>()("app/view/pool-card") {}

PoolCard.size
//         ^?
PoolCard.size._tag
//              ^?
```

Sizes are Effect tagged variants (`_tag: "Card" | "Detail" | "Page"`). Match with
`Match.tag` the same way as elsewhere in the library.

Shipped shortcuts: `View.Card` / `Detail` / `Page` are `SizeChrome` already fulfilled.

{.twoslash}
``` ts
import { Match } from "effect"
import { View } from "hyperlink-ts/ui"

View.Card.statics.size
//              ^?
View.Detail.statics.size
//                ^?
View.Page.statics.size
//              ^?

const label = Match.value(View.ViewKind.Card()).pipe(
  Match.tag("Card", () => "card chrome"),
  Match.tag("Detail", () => "detail chrome"),
  Match.tag("Page", () => "page chrome"),
  Match.exhaustive,
)
void label
```

## Card + Detail + Page + `layer`

Stamp `spec`, mint classes, provide skins, export `layer` — same pattern as
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

## Extra props

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

## Wire into Dashboard

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
