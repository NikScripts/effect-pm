# Composable View Tags — first draft

**Status:** design draft — **not locked**, not Eng’d  
**Branch:** `cursor/file-router-prototype-125f`  
**Split:** `last-ts/View` = DI kernel · this system = **Hyperlink** (or a thin `last-ts` compose later if earned)  
**Replaces (spirit):** today’s `Views.bind` / `Registry` / `react().Card|Detail|Page` kit — not a tweak; a different shape  
**Related:** [view-tag-prototype](./view-tag-prototype.md) · [page-layout-design](./page-layout-design.md)

---

## What’s wrong with v1 match

- API is “pick Card | Detail | Page” — size chrome owns the vocabulary.
- Global string kind registry (`bind(WorkPool.kind, PoolCard)`) is hard to compose/override locally.
- DI View Tag is underused: mostly a key into a matcher, not a composable unit.
- Shell (`compose` + Grid + Outlet) mixed with contribution registry.

**Goal:** View Tags are first-class units you **contribute**, **nest**, **override**, and **mount into slots**. Size is one annotation/slot among many — not the system.

---

## Core ideas

1. **View Tag** (last-ts) — identity + props + annotations + `provide(impl)`.
2. **Slot** — named mount point with a **props Requirement** (what the shell passes in).
3. **Contribution** — “this View Tag fills this Slot (for this target)”.
4. **Catalog** — Layer-built set of contributions; merge / replace / scope.
5. **Mount** — given catalog + target + slot → render the impl (function), not the Tag class.
6. **Nest** — shells are Views too; slots can render other slotted trees.

---

## Draft API (code)

```ts
import { Layer } from "effect"
import * as View from "last-ts/View"
import * as Ui from "hyperlink-ts/ui/Ui" // name TBD — today's Views redesign
import * as WorkPool from "hyperlink-ts/WorkPool"

// =============================================================================
// 1) DI View Tag (unchanged last-ts)
// =============================================================================

class PoolCard extends View.Tag<
  PoolCard,
  { readonly tag: WorkPool.Any; readonly name?: string }
>()("hyperlink/view/pool-card") {}

PoolCard.provide((props) => <card … />)

// Optional: annotate role (not a parallel universe of View.Card.Tag)
class PoolCard2 extends View.Prototype<
  { readonly tag: WorkPool.Any; readonly name?: string }
>()({
  slot: "dashboard/card", // or Data.tagged enum — open
}).Tag<PoolCard2>()("hyperlink/view/pool-card") {}

// =============================================================================
// 2) Slots — shell declares what it can mount
// =============================================================================

const Dashboard = Ui.Shell.make({
  card: Ui.Slot<{ readonly tag: Ui.Leaf; readonly name?: string }>(),
  detail: Ui.Slot<{ readonly tag: Ui.Leaf; readonly name?: string }>(),
  page: Ui.Slot<{ readonly tag: Ui.Leaf; readonly name?: string }>(),
})

// Slot is typed: only Views whose Props satisfy the slot may contribute.
// "card" | "detail" | "page" are *this shell's* names — another shell can invent others.

// =============================================================================
// 3) Contributions — composable Layer, not a hidden global registry
// =============================================================================

const poolUi = Ui.contribute(Dashboard.card, PoolCard)
  .when(WorkPool.kind) // target: family kind, or a concrete tag, or predicate
  // .when(Jobs)           // single tag
  // .when(Ui.any)         // fallback

const daemonUi = Ui.contribute(Dashboard.card, DaemonCard).when(Daemon.kind)

// Merge — Effect Layer composition
const catalog = Layer.mergeAll(poolUi, daemonUi, appOverrides)

// Replace / mask (last wins or explicit)
const catalog2 = catalog.pipe(
  Ui.replace(Dashboard.card, CustomCard).when(Jobs),
  Ui.without(Dashboard.card).when(LegacyKind),
)

// =============================================================================
// 4) Mount — render impl, never the Tag class
// =============================================================================

const ui = Ui.use(catalog) // or Ui.provider(catalog) → hook/kit

// Explicit mount into a slot
<ui.Mount slot={Dashboard.card} tag={Jobs} name="Jobs" />

// Same as: resolve contribution → createElement(Impl, props)

// Optional sugar for a shell (not the only API)
const Dash = Ui.bindShell(Dashboard, catalog)
;<Dash.card tag={Jobs} name="Jobs" />
;<Dash.detail tag={Jobs} />

// =============================================================================
// 5) Nesting — shells are Views; slots mount trees
// =============================================================================

class FleetPanel extends View.Tag<
  FleetPanel,
  { readonly tag: Ui.Leaf }
>()("hyperlink/view/fleet-panel") {}

FleetPanel.provide((props) => (
  <panel>
    <ui.Mount slot={Dashboard.card} tag={props.tag} />
    <ui.Mount slot={Dashboard.detail} tag={props.tag} />
  </panel>
))

// Contribute a *panel* into a denser shell slot
const ops = Ui.contribute(OpsShell.main, FleetPanel).when(Ui.any)

// =============================================================================
// 6) Upward values (same Last bag as page-layout draft)
// =============================================================================

FleetPanel.provide(
  View.gen(function* () {
    // optional: read/provide ambient bag while building impl
    return (props) => {
      /* runtime Last.context via hook bridge later */
      return <panel />
    }
  }),
)

// Deep child View.provide(Last) — compose Types later (V0 on last-ts)

// =============================================================================
// 7) Multiple contributions per slot (pager / stack)
// =============================================================================

// Default: one match. Opt in to many:
const cardStack = Ui.contribute(Dashboard.card, PoolCard)
  .when(WorkPool.kind)
  .mode("stack") // | "one" | "replace"

// Mount renders stack or first — shell decides presentation
;<ui.Mount slot={Dashboard.card} tag={Jobs} mode="stack" />
```

---

## Mapping from today

| Today (`Views`) | Draft |
|-----------------|--------|
| `Views.Card.Tag` | `View.Tag` + optional `slot` annotation **or** contribute into `Dashboard.card` |
| `Views.bind(kind, Tag)` | `Ui.contribute(slot, Tag).when(kind)` |
| `Views.only(tag, …)` | `Ui.replace(slot, Tag).when(tag)` / scoped catalog |
| `Views.Registry` | Catalog Layer (no ambient singleton) |
| `Views.react(layer).Card` | `ui.Mount slot={Shell.card}` / `Dash.card` |
| `Views.compose({ views, router, group })` | Split: **catalog** vs **app chrome** (router/grid stay Hyperlink app) |
| `View.ChromeProvider` | Shell concern — wrap `Mount` or pass via slot props / Hyperlink chrome |

---

## Non-goals (this draft)

- Replacing last-ts `View.Tag` / Prototype.
- Keeping Card/Detail/Page as the *only* slots forever.
- JSX-typed children as the contribute mechanism.
- Moving Hyperlink dashboard into last-ts.

---

## Open forks

1. Module name: keep `Views` vs rename (`Ui`, `ViewKit`, `Catalog`).
2. `.when(kind)` vs target as first arg: `contribute(slot, Tag, target)`.
3. Size as slot name vs annotation on the View Tag.
4. How hard to type “Props of Tag ≤ Props of Slot”.
5. Stack/pager as Mount mode vs separate slot types.

---

## Eng sketch (later)

1. Spec + type tests for `contribute` / `Mount` / merge.  
2. Compatibility shim: `Views.bind` → `contribute(Dashboard.card, …)`.  
3. Migrate family `*View.ts` one module at a time.  
4. Delete Registry singleton once catalog Layer is the only path.
