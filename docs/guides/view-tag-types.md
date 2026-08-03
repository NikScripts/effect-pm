{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class — same shape as Effect’s `Context.Service`.
Mint with `View.Card.Tag` (etc.), provide a skin with `View.provide` (props infer), export `layer`.

## One-shot mint (common path)

`View.Card` / `Detail` / `Page` are size chrome already fulfilled
(`size: ViewKind.Card()` …). Stamp `spec`, optional extra props, mint:

{.twoslash}
``` ts
import { Layer } from "effect"
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

export const layer = Layer.mergeAll(
  View.provide(PoolCard, (props) => {
    props
    // ^?
    return null
  }),
  View.provide(PoolDetail, (_props) => null),
  PoolPage.provide((_props) => null),
)

const kind: View.ViewKind = View.ViewKind.Card()
const label = View.ViewKind.$match(kind, {
  Card: () => "card chrome",
  Detail: () => "detail chrome",
  Page: () => "page chrome",
})
void label
```

Provide skins with **`View.provide(Tag, impl)`** or **`Tag.provide(impl)`**. Props infer from
the Tag. Annotate skins with **`PoolCard["Service"]`** (no `typeof`). Sizes are
`Data.TaggedEnum` — match with `ViewKind.$match` (or `Match.tag` on a
`View.ViewKind`-typed value).

## Extra props

Second type arg on `Tag` — additive props; statics as the value arg:

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

class DenseCard extends View.Card.Tag<
  DenseCard,
  { readonly dense?: boolean }
>()("app/view/dense-card", {
  spec: { kind: "app/dense-card" } as const,
}) {}

export const layer = View.provide(DenseCard, (props) => {
  props
  // ^?
  return null
})
```

Naked (no size): `View.Tag<Greeter, { name: string }>()("…")`.

## Requirement (open chain)

Statics **Requirement** debt can be declared on the root
`View.Prototype<Props, Requirement>()` **or** on any later
`.Prototype<NewProps, NewRequirement>()` step (additive). Statics discharge it
when they satisfy the merged debt.

Dashboard size chrome uses Hyperlink `Views` (`SizeChrome` / `Card` / …):

{.twoslash}
``` ts
import * as View from "hyperlink-ts/ui/View"
import * as Views from "hyperlink-ts/ui/Views"

const Mid = Views.SizeChrome.Prototype<{ readonly dense?: boolean }>()({
  spec: { kind: "app/queue" } as const,
})
// WithSize still open — fulfill last
const Proto = Mid.Prototype()({ size: Views.ViewKind.Card() })
class PoolCard extends Proto.Tag<PoolCard>()("app/view/pool-card") {}

// Or open debt mid-chain on a fulfilled ancestor:
const Base = View.Prototype<{ readonly label: string }>()()
const Open = Base.Prototype<{}, Views.WithSize>()()
const Done = Open.Prototype()({ size: Views.ViewKind.Detail() })

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

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(
    View.provide(WorkerPoolCard, (props) => {
      void props.dense
      return null
    }),
  ),
)
```

Full dogfood: [`examples/apps/web/worker-pool-card.tsx`](../../examples/apps/web/worker-pool-card.tsx).
