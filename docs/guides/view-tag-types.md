{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class. Mint it, write the skin, provide it. Same shape as Effect’s
`Context.Service` — the class is the handle; `Layer.succeed` installs the component.

## Card Tag + skin + layer

{.twoslash}
``` ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"

// The tag: sized chrome handle (`size: "card"` from View.Card).
class PoolCard extends View.Card.Tag<PoolCard>()(
  "app/view/pool-card",
) {}

// The skin: annotate with instance Shape — no typeof.
const PoolCardView: PoolCard["Service"] = (props) => {
  props
  // ^?
  return null
}

// The layer: install the skin on the tag.
const PoolCardLive = Layer.succeed(PoolCard, PoolCardView)
```

`props` is `View.ViewProps` (`tag`, optional `name`). Prefer
`PoolCard["Service"]` over `View.View<View.Type<typeof PoolCard>>` — same Shape.

## Extra props (Prototype)

Accumulate props on a sized Prototype, then mint the class — same pattern as
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

const DenseLive = Layer.succeed(DenseCard, DenseCardView)
```

`props` is `View.ViewProps & { dense?: boolean }`.

## Wire into Dashboard

Allowlist + skin contribution (`R = View.Registry`; Dashboard closes with `View.base`):

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

const WorkerPoolCardView: WorkerPoolCard["Service"] = (props) => {
  // …render using props.tag / props.name / props.dense
  return null
}

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)
```

Full dogfood: [`examples/hyperlink-web/worker-pool-card.tsx`](../../examples/hyperlink-web/worker-pool-card.tsx).
