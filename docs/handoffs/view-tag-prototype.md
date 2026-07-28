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

const Card = Base.Prototype()({ size: "card" as const })
// or more props:
const CardSel = Base.Prototype<{ readonly selected?: boolean }>({ size: "card" as const })

class ScheduleCard extends Card.Tag<ScheduleCard>()("hyperlink/view/schedule-card") {}
ScheduleCard.size  // "card" — static from prototype
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
3. `View.Card.Tag` stamps `size: "card"`; matchers still work via bind  
4. Notes kept here; sync (commit/push) at green checkpoints  

---

## Open (ask before baking)

- Whether `spec` stays an opaque static on family protos vs typed Spec gate  
- Adopt Effect-faithful Tag POC into shipped `View`? (see below)

## WithSize (type-first, 2026-07-28)

**Branch:** `cursor/view-withsize-types-125f`

Size is a **type requirement**, not only a value stamp:

```ts
type WithSize<S extends ViewKind = ViewKind> = { readonly size: S }
type SizedPrototype<Props, Statics extends WithSize> = Prototype<Props, Statics>

// Shared base (union):  WithSize          → size: "card" | "detail" | "page"
// Narrowings:           WithSize<"card">  → View.Card, etc.
```

`View.Card` / `Detail` / `Page` are `SizedPrototype<ViewProps, WithSize<"…">>`.
Prototype merges flatten statics (`Flat`) so `Page.Prototype()({ spec })` hovers as one
object, not `{ size } & { spec }`.

**Open (discuss):** runtime shared proto vs type-only base; whether `Tag` should *require*
`WithSize` (reject naked size-less tags at `bind`); docs twoslash vs named aliases.

## Type previews (served docs)

**Guide:** [`../guides/view-tag-types.md`](../guides/view-tag-types.md) — `pnpm run docs:serve` →  
<http://100.67.32.32:5190/docs/view-tag-types> (Tailscale). Index: [`view-hover-types.md`](./view-hover-types.md).

## Effect-faithful Tag POC (2026-07-28)

**Files:** `examples/forms/view/effect-service-poc.ts` + `test/view-effect-service-poc.test-d.ts` (green).


Replicate `Context.Service<Self, Shape>()("Key")` instead of Prototype + phantom `Type`:

```ts
class DenseCard extends Card<DenseCard, ViewProps & { dense?: boolean }>()("…") {}

const skin: DenseCard["Service"] = (props) => …  // no typeof
type P = PropsOf<DenseCard>                       // peel Props from Service
Layer.succeed(DenseCard, (props) => …)            // infers
```

| Finding | Detail |
|---------|--------|
| **Win** | Instance type carries Effect `ServiceClass.Shape.Service` → `PoolCard["Service"]` is `View<Props>` **without `typeof`** |
| **Win** | `PropsOf<PoolCard>` peels Props from that Shape |
| **Same as Effect** | Self = identity; Shape = `View<Props>`; class value = Context key |
| **vs shipped** | Today: `View.View<View.Type<typeof PoolCard>>` + Prototype chain |

**Not “props named after the class”** — still Self ≠ Props (ServiceClass brands). Annotation target is `DenseCard["Service"]` (the fn), which is short enough.

**Next (if baking):** replace `View.Prototype` / `View.Type` minting with this Tag/Card/Detail form; keep matchers / bind / only / Registry.

## Checkpoint notes (2026-07-27)

- `View.Prototype<Props>()(statics)` **must** be curried — `Prototype<Props>(statics)` defaults Statics to `{}` and drops `size`.
- Reversed shape = `View.View<Props>` from Prototype; Self = DI identity. Phantom `Type` + `View.Type<typeof Tag>`.
- Matchers moved to kit / `useMatch`; size protos are PascalCase `View.Card`/`Detail`/`Page`.
- Svc type renamed: `ViewFn` / `ViewComponent` → **`View.View`** (defaults to `ViewProps`).

## WorkerPool end-to-end (2026-07-28)

`examples/hyperlink-web` uses Prototypes + `View.only` (legacy `forKey` / `widgets` dropped):

```ts
const Proto = View.Card.Prototype<{ readonly dense?: boolean },>()({
  spec: workerPoolCardSpec,
})
export class WorkerPoolCard extends Proto.Tag<WorkerPoolCard>()(
  "examples/hyperlink-web/worker-pool-card",
) {}

export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)
// App: <Dashboard views={layer} … />
```

Dashboard merges `UiDashboardViews.layer` + `views?`, then `provideMerge(skins)` + `provideMerge(View.base)`.
