# DI Views — typed nested JSX (draft)

**Status:** design locked — **fix JSX erasure** so nested components carry requirements for real.  
**Not:** invent a parallel compose API that covers up the erase.

---

## Destination

```tsx
const Component = () => (
  <Parent>
    <Child />
  </Parent>
)
```

Requirement types flow **child → parent → the component function** through real JSX typing. Nesting is normal React nesting; the type channel is not erased.

---

## How (types)

Custom `jsxImportSource` (e.g. `last-ts/jsx`):

```ts
// Element carries R; jsx() merges child R into parent Element’s R
type Element<R = never> = …

// Component’s R = what it yields + what its returned tree’s Elements need
type Component<P, R = never> = (props: P) => Element<R>

// View.gen: Effect R from yield* becomes Component R
const Child = View.gen(function* () {
  const GreeterView = yield* Greeter
  return () => <GreeterView name="x" />
})
// Child: Component<{}, Greeter>

const Parent = View.gen(function* () {
  return () => (
    <div>
      <Child />
    </div>
  )
})
// Parent: Component<{}, Greeter>  — Child’s R bubbled through JSX

const Page = () => (
  <Parent>
    <Child />
  </Parent>
)
// Page’s tree Element R includes Greeter from both children
```

Runtime can still emit React elements. **Types** stop the erase.

---

## Gen = the component

```ts
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  )
})

// Use nested — types propagate
export const Page = View.gen(function* () {
  return () => (
    <section>
      <Hello who="nik" />
    </section>
  )
})
```

| | Role |
|--|------|
| `View.gen` | The component you export and nest |
| `yield* Tag` | Downward service need → part of that component’s `R` |
| Nested JSX | Bubbles child `R` into parent `Element` / enclosing component |
| `Tag.provide` / Layer | App edge — fulfill the aggregated `R` once |
| `Last.provide` | Upward values (other direction) |

---

## Not this

```ts
// WRONG — wrapping gen in Layer to “exist”
Hello.provide(View.gen(…))

// WRONG — invent slots / catalogs / View.el Need brands to bypass JSX
yield* needs(Hello)
View.el(Parent, { children: View.el(Child) })
```

Don’t invent junk type systems to replace what React erased. **Fix the erasure.**

---

## Eng order (when owner says go)

1. `last-ts/jsx` — `Element<R>`, `jsx`/`jsxs` merge child `R`, package `jsxImportSource`.
2. Wire `View.gen` / `fromEffect` return type to `Component<P, R>`.
3. `.test-d.ts`: nested `<Parent><Child /></Parent>` surfaces Child’s tags on the tree / parent.
4. Small: gen `void` → `() => null`.
