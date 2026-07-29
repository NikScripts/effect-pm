{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class — same shape as Effect’s `Context.Service`.
Mint with `View.Card.Tag` (etc.), write the skin, export `layer`.

## One-shot mint (common path)

`View.Card` / `Detail` / `Page` are size chrome already fulfilled
(`size: ViewKind.Card()` …). Stamp `spec`, optional extra props, mint:

{.twoslash}
``` ts
import { Layer, Match } from "effect"
import { View } from "hyperlink-ts/ui"

class PoolCard extends View.Card.Tag<PoolCard>()(
  "app/view/pool-card",
  { spec: { kind: "app/queue" } as const },
) {}
class PoolDetail extends View.Detail.Tag<PoolDetail>()(
  "app/view/pool-detail",
  { spec: { kind: "app/queue" } as const },
) {}
class PoolPage extends View.Page.Tag<PoolPage>()(
  "app/view/pool-page",
  { spec: { kind: "app/queue" } as const },
) {}

PoolCard.size
//         ^?
PoolCard.size._tag
//              ^?

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

const label = Match.value(View.ViewKind.Card()).pipe(
  Match.tag("Card", () => "card chrome"),
  Match.tag("Detail", () => "detail chrome"),
  Match.tag("Page", () => "page chrome"),
  Match.exhaustive,
)
void label
```

Annotate skins with **`PoolCard["Service"]`** (no `typeof`).
Sizes are `Data.TaggedEnum` — match with `Match.tag`.

## Extra props

Second type arg on `Tag` — additive props; statics as the value arg:

{.twoslash}
``` ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"

class DenseCard extends View.Card.Tag<
  DenseCard,
  { readonly dense?: boolean }
>()("app/view/dense-card", {
  spec: { kind: "app/dense-card" } as const,
}) {}

const DenseCardView: DenseCard["Service"] = (props) => {
  props
  // ^?
  return null
}

export const layer = Layer.succeed(DenseCard, DenseCardView)
```

Naked (no size): `View.Tag<Greeter, { name: string }>()("…")`.

## Requirement (open chain)

When you need to declare debt before fulfilling — `SizeChrome` + `.Prototype()`:

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

const Mid = View.SizeChrome.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
})
// WithSize still open — fulfill last
const Proto = Mid.Prototype()({ size: View.ViewKind.Card() })
class PoolCard extends Proto.Tag<PoolCard>()("app/view/pool-card") {}

PoolCard.size
//         ^?
```

## Wire into Dashboard

```ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"
import { WorkerPool } from "./hub"

export class WorkerPoolCard extends View.Card.Tag<
  WorkerPoolCard,
  { readonly dense?: boolean }
>()("examples/apps/web/worker-pool-card", {
  spec: { kind: "examples/worker-pool-card" } as const,
}) {}

const WorkerPoolCardView: WorkerPoolCard["Service"] = (_props) => null

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)
```

Full dogfood: [`examples/apps/web/worker-pool-card.tsx`](../../examples/apps/web/worker-pool-card.tsx).
