# DI View Tags — what more (draft)

**Status:** design draft — **not locked**  
**Focus:** View Tag = component **service** (same shape as other Effect services; impl is JSX).  
**Rejected here:** Catalog/slots as the core model — a Tag *is* the slot.

---

## Already have

```ts
class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
  "app/view/greeter",
) {}

// Fulfill with a JSX impl (Layer)
Greeter.provide(({ name }) => <h1>{name}</h1>)
```

Tag = identity. Layer carries the function. That is the product.

---

## Gap: use the Tag like a component

Today the Tag is not JSX. Draft:

```ts
// Fancy: Tag exposes a React component that resolves impl from Context
;<Greeter.View name="nik" />

// or module helper with same types
;<View.Use tag={Greeter} name="nik" />
```

Under the hood: read `Greeter` from React/Effect context (bridge), then `createElement(impl, props)`.  
Still not “the class is a host component” in React’s sense — it’s a thin resolver component attached to the Tag (`Greeter.View`).

If `Greeter` is missing from the Layer → fail at the **boundary** (see below), not necessarily at first render if we type it.

---

## Gap: require other View Tags (Layer R), not value bags

Same *shape* as upward `Last.provide` discharge, but the debt is **services**:

```ts
// Parent view's impl needs Greeter in scope
class PageBody extends View.Tag<PageBody, {}>()("app/view/page-body") {}

PageBody.provide(
  View.gen(function* () {
    // Building the impl may depend on services…
    return () => (
      <div>
        <Greeter.View name="nik" />
      </div>
    )
  }),
)
```

**Typing intent:** using `<Greeter.View />` (or `View.Use(Greeter)`) **adds `Greeter` to the tree’s Requirement** (Effect `R`). That debt bubbles through parent Views until a **Page** (or app root) that `Layer.provide` / `provideMerge`s Greeter — or type error.

```ts
// Pseudotype
type Tree = View.Tree<PageBody> // R includes Greeter until provided

Page.mount(PageBody) // error: Greeter not provided
Page.mount(PageBody).pipe(Layer.provide(Greeter.provide(…))) // ok
```

Provide **anywhere earlier** in the Layer graph (not only at the leaf). Last Layer wins for a given Tag (normal Effect).

This is **not** Catalog.contribute(slot). The Tag *is* the dependency key.

---

## What more we can do with component services

```ts
// 1) Same Tag, swap impl (web / test / ink) — already Layer-native
Layer.provide(Greeter.provide(WebImpl))
Layer.provide(Greeter.provide(TestImpl))

// 2) Mount Tag as component (draft)
;<Greeter.View name="nik" />

// 3) View depends on View — R accumulates
class Hello extends View.Tag<Hello, {}>()("app/view/hello") {}
Hello.provide(() => (
  <>
    <Greeter.View name="a" />
    <Greeter.View name="b" />
  </>
))
// Tree R: Greeter (once)

// 4) Defaults on Tag (like Context.Reference) — draft
class Greeter2 extends View.Tag<Greeter2, { name: string }>()(
  "app/view/greeter2",
  { default: ({ name }) => <span>{name}</span> },
) {}

// 5) Prototype still owns props + annotations; Requirement can mean
//    annotation debt OR (later) service debt — keep separate channels if clearer

// 6) View.gen closes over Effect services, returns JSX fn — already
View.gen(function* () {
  const cfg = yield* Config
  return () => <Greeter.View name={cfg.defaultName} />
})

// 7) Page / app root = discharge boundary for View R
Page.body(Hello) // must provide everything Hello's tree requires

// 8) Scoped override
;<View.Region layer={Greeter.provide(LoudImpl)}>
  <Hello.View />
</View.Region>

// 9) Test: provide fake impl, render tree
Greeter.provide(() => <div data-testid="g" />)

// 10) Lazy / async impl via fromEffect — still one Tag
Greeter.provide(View.fromEffect(loadRemoteGreeter))
```

---

## Non-goals (this draft)

- Parallel slot/catalog vocabulary for “where Card goes”.
- Matching Card/Detail/Page as the DI model.
- Typing arbitrary JSX children; debt comes from **`.View` / `View.Use(Tag)`** (or explicit `View.need(Tag)`).

---

## Open

1. `Greeter.View` vs `View.Use(Greeter)` vs both.
2. How React context bridges Effect Layer (RuntimeProvider already nearby).
3. Whether service-Requirement is a second type param beside annotation-Requirement.
4. Page as hard boundary vs any `View.Root`.
