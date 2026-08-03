{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

A View Tag is a class — same shape as Effect’s `Context.Service`.
DI mint/`provide` live on `last-ts/View` (or `hyperlink-ts/ui/View`). Dashboard
size chrome + bind live on `hyperlink-ts/ui/Views`.

Prototype-managed metadata is a single **annotations** bag (Effect/ZIO-style —
any keys). Getter helper (same role as `Group.members`):

```ts
View.annotations(PoolCard).size
View.annotations(PoolCard).spec
type Size = View.AnnotationsOf<typeof PoolCard>["size"] // was StaticsOf
```

Class surface stays free for app `static` fields.

## One-shot mint (common path)

`Views.Card` / `Detail` / `Page` are size chrome already fulfilled
(`annotations.size: ViewKind.Card()` …). Stamp `spec` into the bag, optional extra
props, mint:

{.twoslash}
``` ts
import { Layer } from "effect"
import * as View from "hyperlink-ts/ui/View"
import * as Views from "hyperlink-ts/ui/Views"

class PoolCard extends Views.Card.Tag<PoolCard>()(
  "app/view/pool-card",
  { spec: { kind: "app/queue" } as const },
) {}
class PoolDetail extends Views.Detail.Tag<PoolDetail>()(
  "app/view/pool-detail",
  { spec: { kind: "app/queue" } as const },
) {}
class PoolPage extends Views.Page.Tag<PoolPage>()(
  "app/view/pool-page",
  { spec: { kind: "app/queue" } as const },
) {}

View.annotations(PoolCard).size
//                        ^?
View.annotations(PoolCard).size._tag
//                             ^?

export const layer = Layer.mergeAll(
  View.provide(PoolCard, (props) => {
    props
    // ^?
    return null
  }),
  View.provide(PoolDetail, (_props) => null),
  PoolPage.provide((_props) => null),
)

const kind: Views.ViewKind = Views.ViewKind.Card()
const label = Views.ViewKind.$match(kind, {
  Card: () => "card chrome",
  Detail: () => "detail chrome",
  Page: () => "page chrome",
})
void label
```

Provide skins with **`View.provide(Tag, impl)`** or **`Tag.provide(impl)`**. Props infer from
the Tag. Annotate skins with **`PoolCard["Service"]`** (no `typeof`). Sizes are
`Data.TaggedEnum` — match with `ViewKind.$match` (or `Match.tag` on a
`Views.ViewKind`-typed value). Read size/spec via **`View.annotations(Tag)`**.

## Extra props

Second type arg on `Tag` — additive props; Prototype annotations as the value arg
(merged into `.annotations`):

{.twoslash}
``` ts
import * as View from "hyperlink-ts/ui/View"
import * as Views from "hyperlink-ts/ui/Views"

class DenseCard extends Views.Card.Tag<
  DenseCard,
  { readonly dense?: boolean }
>()("app/view/dense-card", {
  spec: { kind: "app/dense-card" } as const,
}) {
  /** App-owned class static — not in the Prototype bag. */
  static readonly region = "us" as const
}

export const layer = View.provide(DenseCard, (props) => {
  props
  // ^?
  return null
})
```

Naked (no size): `View.Tag<Greeter, { name: string }>()("…")`.

## Requirement (open chain)

Annotations **Requirement** debt can be declared on the root
`View.Prototype<Props, Requirement>()` **or** on any later
`.Prototype<NewProps, NewRequirement>()` step (additive). The Requirement
describes keys **inside the annotations bag**; annotations discharge it when the
bag satisfies the merged debt.

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

PoolCard.annotations.size
//                        ^?
```

## Wire into Dashboard

```ts
import { Layer } from "effect"
import * as View from "hyperlink-ts/ui/View"
import * as Views from "hyperlink-ts/ui/Views"
import { WorkerPool } from "./hub"

export class WorkerPoolCard extends Views.Card.Tag<
  WorkerPoolCard,
  { readonly dense?: boolean }
>()("examples/apps/web/worker-pool-card", {
  spec: { kind: "examples/worker-pool-card" } as const,
}) {}

export const layer = Views.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(
    View.provide(WorkerPoolCard, (props) => {
      void props.dense
      return null
    }),
  ),
)
```
