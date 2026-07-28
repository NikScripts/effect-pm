{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

Real shipped API. Persistent `// ^?` popups show the compiler’s types — no fake stand-ins.

{.note}
Shipped tags mint `Context.ServiceClass`. Prefer **`PoolCard["Service"]`** (no `typeof`).
The long form `View.View<View.Type<typeof PoolCard>>` is the same Shape.

## Mint a card Tag

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

class PoolCard extends View.Card.Tag<PoolCard>()(
  "docs/view-tag-types/PoolCard",
) {}
// ---cut---
type Service = PoolCard["Service"]
//   ^?

type Props = View.Type<typeof PoolCard>
//   ^?

const size = PoolCard.size
//    ^?
```

## Annotate a skin (prefer instance `.Service`)

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

class PoolCard extends View.Card.Tag<PoolCard>()(
  "docs/view-tag-types/PoolCard",
) {}
// ---cut---
const skin: PoolCard["Service"] = (props) => null
//    ^?

// Same Shape, longer:
const long: View.View<View.Type<typeof PoolCard>> = (props) => null
//    ^?
```

## Props inferred by `Layer.succeed`

{.twoslash}
``` ts
import { Layer } from "effect"
import { View } from "hyperlink-ts/ui"

class PoolCard extends View.Card.Tag<PoolCard>()(
  "docs/view-tag-types/PoolCard",
) {}
// ---cut---
const layer = Layer.succeed(PoolCard, (props) => {
  props
  // ^?
  return null
})
```

## Extra Prototype props

Same pattern as the WorkerPool example card — accumulate props on a sized Prototype,
then mint the Tag:

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

type Extra = { readonly dense?: boolean }

const Proto = View.Card.Prototype<Extra>()({
  spec: { kind: "docs/dense-card" } as const,
})

class DenseCard extends Proto.Tag<DenseCard>()(
  "docs/view-tag-types/DenseCard",
) {}

declare function expand<T>(x: T): { [K in keyof T]: T[K] }
// ---cut---
type Service = DenseCard["Service"]
//   ^?

type Props = View.Type<typeof DenseCard>
//   ^?

declare const props: View.Type<typeof DenseCard>
props
// ^?

const full = expand(props)
full
// ^?
```

## Short vs long (same Shape)

{.twoslash}
``` ts
import { View } from "hyperlink-ts/ui"

class PoolCard extends View.Card.Tag<PoolCard>()(
  "docs/view-tag-types/PoolCard",
) {}
// ---cut---
type Prefer = PoolCard["Service"]
//   ^?

type Long = View.View<View.Type<typeof PoolCard>>
//   ^?
```

## Cheat sheet

| Want | Write |
|------|--------|
| Component fn | `PoolCard["Service"]` |
| Annotate a skin | `const skin: PoolCard["Service"] = …` |
| Provide | `Layer.succeed(PoolCard, (props) => …)` |
| Props bag | `View.Type<typeof PoolCard>` |
| Size static | `PoolCard.size` → `"card"` |

Dogfood: [`examples/hyperlink-web/worker-pool-card.tsx`](../../examples/hyperlink-web/worker-pool-card.tsx).
