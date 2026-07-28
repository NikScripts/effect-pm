# View.Tag + Prototype — notes (2026-07-27)

**Branch:** `cursor/tui-dashboard-parity-125f`  
**Status:** Eng’d (checkpoint) — Tag + Prototype types green; size add-on prototypes live.

---

## Intent

1. **`View.Tag` = THE tool for DI components** (Context.Service). Not chrome-specific.
2. **Shape is reversed:** Self is the **input props** interface (what the component receives), not a callable service API. `Layer.succeed(PoolCard, Comp)` → `Comp` must accept `PoolCard` as props.
3. **`View.Prototype`** accumulates **props (type)** + **statics (runtime accessors)** before minting a Tag.
4. **`card` / `detail` / `page`** are an **add-on** (sized prototypes + matchers). They do **not** own `View.Tag`.
5. **`View.Card` / `Detail` / `Page` stay matchers** (taken). Size prototypes are lowercase: `View.card` / `View.detail` / `View.page`.

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
class PoolCard extends View.card.Tag<PoolCard>()("hyperlink/view/pool-card") {}

Layer.succeed(PoolCard, (props) => { … })  // props: ViewProps
// or explicit: View.Type<typeof PoolCard> / View.PropsOf<typeof View.card>
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
| `View.card` / `.detail` / `.page` | Sized add-on protos (`ViewProps` + `size` static) |

Statics are for things we used to jam into Tag args (`size`, later `spec`, etc.).

---

## Chrome add-on (not Tag core)

- Matchers: `View.Card` / `Detail` / `Page` (unchanged names).
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
3. `View.card.Tag` stamps `size: "card"`; matchers still work via bind  
4. Notes kept here; sync (commit/push) at green checkpoints  

---

## Open (ask before baking)

- Whether `spec` stays an opaque static on family protos vs typed Spec gate  
- Can we get closer to “props named after the class” without fighting `ServiceClass` instance brands?  

## Checkpoint notes (2026-07-27)

- `View.Prototype<Props>()(statics)` **must** be curried — `Prototype<Props>(statics)` defaults Statics to `{}` and drops `size`.
- Reversed shape = `ViewFn<Props>` from Prototype; Self = DI identity. Phantom `Type` + `View.Type<typeof Tag>`.
- Matchers `View.Card`/`Detail`/`Page` unchanged; size protos are lowercase.
