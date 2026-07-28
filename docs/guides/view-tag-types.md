{#view-tag-types title="View Tag types" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/view-tag-types>.
<!-- docs-site-link:end -->
# View Tag types

Full shapes for View Tag / `Service` — persistent `// ^?` popups in the browser (no IDE).
Same dual-view trick as [type previews](/docs/type-previews): compact name, then expanded
members.

{.note}
Shipped tags mint `Context.ServiceClass`. **`PoolCard["Service"]` is already the component fn** —
you do not need `View.View<View.Type<typeof PoolCard>>`.

## Effect baseline — instance `.Service` is Shape

For `class Config extends Context.Service<Config, Shape>()("…")`, `Config["Service"]` is Shape:

{.twoslash}
``` ts
// Config["Service"] after Context.Service<Config, { port: number }>
interface ConfigService {
  readonly port: number
}

declare function expand<T>(x: T): { [K in keyof T]: T[K] }

declare const shape: ConfigService
// ---cut---
shape
// ^?

const full = expand(shape)
full
// ^?
```

## `PoolCard["Service"]` — the component fn

What `class PoolCard extends View.Card.Tag<PoolCard>()("…") {}` stores as Shape
(`View.View` / props → element). Twoslash shows the alias; annotate skins with this name:

{.twoslash}
``` ts
interface ViewProps {
  readonly tag: { readonly key: string }
  readonly name?: string
}

// PoolCard["Service"] === View.View<ViewProps>
type PoolCardService = (props: ViewProps) => null
// ---cut---
type Shown = PoolCardService
//   ^?
```

## Props bag — `ViewProps`

What `Layer.succeed(PoolCard, (props) => …)` infers for `props`:

{.twoslash}
``` ts
interface ViewProps {
  readonly tag: { readonly key: string }
  readonly name?: string
}

declare function expand<T>(x: T): { [K in keyof T]: T[K] }

declare const props: ViewProps
// ---cut---
props
// ^?

const full = expand(props)
full
// ^?
```

## Extra Prototype props — `DenseCard`

`View.Card.Prototype<{ dense?: boolean }>()({…}).Tag` merges into props.
`DenseCard["Service"]` is still a component fn; the interesting shape is the props bag:

{.twoslash}
``` ts
interface ViewProps {
  readonly tag: { readonly key: string }
  readonly name?: string
}

interface DenseCardProps extends ViewProps {
  readonly dense?: boolean
}

// DenseCard["Service"]
type DenseCardService = (props: DenseCardProps) => null

declare function expand<T>(x: T): { [K in keyof T]: T[K] }

declare const props: DenseCardProps
// ---cut---
type Shown = DenseCardService
//   ^?

props
// ^?

const full = expand(props)
full
// ^?
```

## Annotate a skin (no `typeof`)

```ts
const skin: PoolCard["Service"] = (props) => null
```

Rendered equivalent — compact `PoolCardService` on the binding:

{.twoslash}
``` ts
interface ViewProps {
  readonly tag: { readonly key: string }
  readonly name?: string
}

type PoolCardService = (props: ViewProps) => null
// ---cut---
const skin: PoolCardService = (props) => null

skin
// ^?
```

## Short vs long annotation (same Shape)

| Prefer | Equivalent long form |
|--------|----------------------|
| `PoolCard["Service"]` | `View.View<View.Type<typeof PoolCard>>` |
| `DenseCard["Service"]` | `View.View<View.Type<typeof DenseCard>>` |

## Cheat sheet

| Want | Write |
|------|--------|
| Component fn type | `PoolCard["Service"]` |
| Annotate a skin | `const skin: PoolCard["Service"] = …` |
| Provide | `Layer.succeed(PoolCard, (props) => …)` |
| Props bag (optional) | peel from Service, or `View.Type<typeof PoolCard>` |
| Size static | `PoolCard.size` → `"card"` |
