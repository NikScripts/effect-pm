# View.Tag + Prototype — notes (2026-07-27)

**Branch:** `cursor/tui-dashboard-parity-125f`  
**Status:** Eng’d — Tag/Prototype + size add-ons + Dashboard `views` + WorkerPool `View.only` e2e.

---

## Intent

1. **`View.Tag` = THE tool for DI components** (Context.Service). Not chrome-specific.
2. **Shape is reversed:** Self is the **input props** interface (what the component receives), not a callable service API. `Layer.succeed(PoolCard, Comp)` → `Comp` must accept `PoolCard` as props.
3. **`View.Prototype`** accumulates **props (type)** + **statics (runtime accessors)** before minting a Tag.
4. **`card` / `detail` / `page`** are an **add-on** (sized prototypes + matchers). They do **not** own `View.Tag`.
5. **`View.Card` / `Detail` / `Page` are sized Prototypes.** Matchers live on `View.react` / `compose` kits (`ui.Card`) and `View.useMatch()`.

---

## Reversed service

Normal Hyperlink tag:

```ts
Context.Service<Self, ServiceApi>  // yield* Tag → capabilities (output API)
```

View tag (reversed):

```ts
Context.ServiceClass<Self, Key, (props: Props) => ReactElement | null>
// Self  = DI identity (the class)
// Props = input shape from Prototype (what the component receives)
// provide = component implementation
```

`ServiceClass` instance typing always carries key/Service brands, so **Self cannot also be the clean props bag**. Props live on the Prototype chain; the handle carries a phantom `Type`:

```ts
class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}

Layer.succeed(PoolCard, (props) => { … })  // props: ViewProps
// or explicit: View.Type<typeof PoolCard> / View.PropsOf<typeof View.Card>
```

---

## Prototype chain

```ts
const Base = View.Prototype<{ readonly tag: ViewTag; readonly name?: string }>()

const Card = Base.Prototype()({ size: View.ViewKind.Card() })
// or more props:
const CardSel = Base.Prototype<{ readonly selected?: boolean }>()({
  size: View.ViewKind.Card(),
})

class ScheduleCard extends Card.Tag<ScheduleCard>()("hyperlink/view/schedule-card") {}
ScheduleCard.size  // ViewKind.Card() — `{ _tag: "Card" }`
ScheduleCard.key   // "hyperlink/view/schedule-card"
```

| Piece | Role |
|-------|------|
| `View.Prototype<Props>()(statics?)` | Root proto (curried so Statics infer) |
| `proto.Prototype<NewProps>()(statics?)` | Extend props + merge statics |
| `proto.Tag<Self extends Props>()(key)` | Mint Context.Service handle |
| `View.Tag` | Convenience = empty proto’s Tag (naked DI) |
| `View.Card` / `.Detail` / `.Page` | Sized add-on protos (`ViewProps` + `size` static) |

Statics are for things we used to jam into Tag args (`size`, later `spec`, etc.).

---

## Chrome add-on (not Tag core)

- Matchers: `ui.Card` / `ui.Detail` / `ui.Page` from `View.react` / `compose`, or `View.useMatch()`.
- Registry bind still needs a **size** — read `view.size` from sized prototypes.
- `View.bind` / `View.only` only accept handles with `size: ViewKind`.
- Naked `View.Tag` = DI only (no matcher registration without a size static).

---

## Non-goals (this slice)

- Kit batteries Dashboard
- Renaming matchers
- Full Spec gate typing on prototypes (statics can carry `spec` opaquely for now)

---

## Acceptance

1. `View.Tag` / `Prototype` have no required `card|detail|page` arg  
2. `Layer.succeed(PoolCard, fn)` types `fn` props as `PoolCard`  
3. `View.Card.Tag` stamps `size: ViewKind.Card()`; matchers still work via bind  
4. Notes kept here; sync (commit/push) at green checkpoints  

---

## Open (ask before baking)

- Whether `spec` stays an opaque static on family protos vs typed Spec gate

## `ui.data` on compose (Eng’d 2026-07-28)

```ts
const ui = View.compose({ views, navigator })
// under RuntimeProvider:
const bundle = ui.data.queue(Jobs)   // QueueBundle
const d = ui.data.daemon(Nightly)
```

Shared `src/ui/runtime.tsx` (`RuntimeProvider` + door). Guide: [`../guides/view-data.md`](../guides/view-data.md).

## Effect-faithful Tag mint (Eng’d 2026-07-28)

One-shot mint on shipped size chrome (POC folded in; keep Prototype for open Requirement):

```ts
class PoolCard extends View.Card.Tag<PoolCard>()("…", { spec }) {}
class Dense extends View.Card.Tag<Dense, ViewProps & { dense?: boolean }>()("…") {}
const skin: PoolCard["Service"] = (props) => …  // no typeof
type P = View.PropsOf<PoolCard>
```

## Requirement / WithSize (2026-07-28)

**Branch:** `cursor/view-withsize-types-125f`

`Prototype<Props, Requirement, Statics>` — Requirement is R-style debt:

```ts
View.SizeChrome                                      // open WithSize
  .Prototype<{ dense?: boolean }>()({ spec: … })     // chain while open
  .Prototype()({ size: View.ViewKind.Card() })       // fulfill → Requirement {}

View.Card / Detail / Page   // SizeChrome already fulfilled
```

`ViewKind` is `Data.TaggedEnum` (`Card` / `Detail` / `Page`) — match with `Match.tag`.

Helpers: `RequirementOf` / `IsFulfilled` / `PropsOf` / `StaticsOf` / `OpenPrototype` /
`FulfilledPrototype`. Tag does not fulfill — `bind` needs `.size` on the class.
Guide: [`../guides/view-tag-types.md`](../guides/view-tag-types.md).

## Type previews (served docs)

**Guide:** [`../guides/view-tag-types.md`](../guides/view-tag-types.md) — `pnpm run docs:serve` →  
<http://100.67.32.32:5190/docs/view-tag-types> (Tailscale). Index: [`view-hover-types.md`](./view-hover-types.md).

## Effect-faithful Tag POC (archived — baked)

Historical POC: `examples/view/effect-service-poc.ts`. Behavior now on
shipped `View.Card.Tag` / `PropsOf` / `["Service"]` (see above).

## Checkpoint notes (2026-07-27)

- `View.Prototype<Props>()(statics)` **must** be curried — `Prototype<Props>(statics)` defaults Statics to `{}` and drops `size`.
- Reversed shape = `View.View<Props>` from Prototype; Self = DI identity. Phantom `Type` + `View.Type<typeof Tag>`.
- Matchers moved to kit / `useMatch`; size protos are PascalCase `View.Card`/`Detail`/`Page`.
- Svc type renamed: `ViewFn` / `ViewComponent` → **`View.View`** (defaults to `ViewProps`).

## WorkerPool end-to-end (2026-07-28)

`examples/hyperlink-web` uses Prototypes + `View.only` (legacy `forKey` / `widgets` dropped):

```ts
export class WorkerPoolCard extends View.Card.Tag<
  WorkerPoolCard,
  { readonly dense?: boolean }
>()("examples/apps/web/worker-pool-card", {
  spec: workerPoolCardSpec,
}) {}

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)
// App: <Dashboard views={layer} … />
```

Dashboard merges `UiDashboardViews.layer` + `views?`, then `provideMerge(skins)` + `provideMerge(View.base)`.
