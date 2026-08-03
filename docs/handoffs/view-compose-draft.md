# Composable View Tags — first draft (generic)

**Status:** design draft — **not locked**, not Eng’d  
**Package:** last-ts shaped (`View`, catalog helpers) — **no product/domain vocabulary**  
**Kernel:** `View.Tag` / `Prototype` / `provide` stay as they are; this draft is how you **compose** them.

---

## Problem

A View Tag is DI identity + a component impl. Matching “kinds” into fixed chrome slots is one app pattern — not the system. We need:

- contribute View Tags into **named, typed slots**
- merge / replace contributions as **Layers**
- **mount** the impl (function), never the Tag class
- nest: a View can mount other slots
- stay generic: any props, any slot names

---

## Draft API

```ts
import { Layer } from "effect"
import * as View from "last-ts/View"
import * as Catalog from "last-ts/Catalog" // name TBD — compose surface

// =============================================================================
// View Tag (existing)
// =============================================================================

class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}

Greeter.provide(({ name }) => <h1>{name}</h1>)

class QuietGreeter extends View.Tag<QuietGreeter, { readonly name: string }>()(
  "app/view/greeter-quiet",
) {}

QuietGreeter.provide(({ name }) => <p>{name}</p>)

// =============================================================================
// Shell = set of slots (typed props each slot will pass)
// =============================================================================

const App = Catalog.shell({
  hero: Catalog.slot<{ readonly name: string }>(),
  aside: Catalog.slot<{ readonly name: string }>(),
})

// Another shell can use totally different slot names / props — no fixed vocabulary.

// =============================================================================
// Contribute Tag → slot (+ optional target)
// =============================================================================

const base = Layer.mergeAll(
  Catalog.contribute(App.hero, Greeter),
  Catalog.contribute(App.aside, Greeter),
)

// Target: only when some identity matches (generic key / predicate — not domain-specific)
const override = Catalog.contribute(App.hero, QuietGreeter).when(
  Catalog.target.key("app/entity/special"),
)

const catalog = Layer.mergeAll(base, override)

// Replace / remove
catalog.pipe(
  Catalog.replace(App.hero, QuietGreeter).when(Catalog.target.key("app/entity/special")),
  Catalog.without(App.aside).when(Catalog.target.key("app/entity/hidden")),
)

// =============================================================================
// Mount — resolve contribution, render impl
// =============================================================================

const ui = Catalog.use(catalog)

// props must satisfy the slot; Tag's Props must be assignable from slot props
;<ui.Mount slot={App.hero} name="nik" />
;<ui.Mount
  slot={App.hero}
  name="nik"
  target={Catalog.target.key("app/entity/special")}
/>

// =============================================================================
// Nest — a View mounts other slots
// =============================================================================

class Panel extends View.Tag<Panel, { readonly name: string }>()(
  "app/view/panel",
) {}

Panel.provide((props) => (
  <section>
    <ui.Mount slot={App.hero} name={props.name} />
    <ui.Mount slot={App.aside} name={props.name} />
  </section>
))

const nested = Catalog.contribute(
  Catalog.shell({ main: Catalog.slot<{ readonly name: string }>() }).main,
  Panel,
)

// =============================================================================
// Many matches (opt-in)
// =============================================================================

Catalog.contribute(App.hero, Greeter).mode("one")   // default — single impl
Catalog.contribute(App.hero, Greeter).mode("stack") // all matching; Mount stacks them

;<ui.Mount slot={App.hero} name="nik" mode="stack" />
```

---

## Rules

1. Tag class is never JSX — only the provided `View` function mounts.
2. Slot props are the contract; contributing Tag’s Props must accept them.
3. Catalog is a **Layer** — compose with `Layer.mergeAll`, no ambient singleton.
4. `.when(target)` scopes a contribution; omit = always eligible for that slot.
5. Slot names are app-defined strings/symbols — library ships no Card/Detail/Page.

---

## Open

- Module name: `Catalog` vs fold into `View.*`
- Target model: key string vs `Context.Key` vs predicate
- Typing `contribute(slot, Tag)` when Props differ by optional fields
- Whether `shell` is runtime value + types or type-only brands
