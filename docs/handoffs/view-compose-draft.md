# DI Views — typed nested JSX

**Status:** Eng’d on `cursor/file-router-prototype-125f` — fix JSX erasure so nested components carry requirements for real.  
**Not:** invent a parallel compose API that covers up the erase.

---

## Destination

```tsx
/** @jsxImportSource last-ts */
const Component = () => (
  <Parent>
    <Child />
  </Parent>
)
```

Requirement types flow **child → parent → the component function** through real JSX typing. Nesting is normal React nesting; the type channel is not erased.

---

## How

### `last-ts/jsx-runtime` (+ `jsx-dev-runtime`)

- Runtime delegates to `react/jsx-runtime` / `react/jsx-dev-runtime`.
- Types: `jsx` / `jsxs` return `Element<R_type | R_children>`.
- **Do not** export `namespace JSX { type Element = … }` — a non-generic `JSX.Element` collapses `R` and restores erasure. Expression types come from the `jsx` / `jsxs` return types.
- Host props from React `IntrinsicElements`; outside components (Radix / shadcn) stay valid tags (`ElementType` permissive).

### `View`

```ts
type View<Props, R = never> = ((props: Props) => ReactElement | null) & {
  readonly "~last-ts/View/services": R
}

View.gen / fromEffect / succeed  →  View<Props, EffectR | TreeR>
View.ServicesOf<typeof Comp>     →  R
View.stamp(fn)                   →  stamp R onto a plain component (provide / fallbacks)
```

`R` = `yield*` services ∪ nested JSX child services (when using `jsxImportSource: "last-ts"`).  
Render returns a normal `ReactElement` so createElement / Radix / shadcn interop.

### Opt-in

```json
{ "jsx": "react-jsx", "jsxImportSource": "last-ts" }
```

or per-file `/** @jsxImportSource last-ts */`.

---

## Gen = the component

```ts
export const Hello = View.gen(function* () {
  const GreeterView = yield* Greeter
  return (props: { readonly who: string }) => (
    <GreeterView name={props.who} />
  )
})

export const Page = View.gen(function* () {
  return () => (
    <section>
      <Hello who="nik" />
    </section>
  )
})
// Page: View<{}, Greeter> when Greeter is in Hello’s R
```

| | Role |
|--|------|
| `View.gen` | The component you export and nest |
| `yield* Tag` | Downward service need → part of that component’s `R` |
| Nested JSX | Bubbles child `R` into parent `Element` / enclosing component |
| `Tag.provide` / Layer | App edge — fulfill the aggregated `R` once |
| `Last.provide` | Upward values (other direction) |

---

## Verification

- `test/view-jsx.test-d.tsx` — nesting, View.gen `R`, Radix Dialog + shadcn-style wrappers, negative prop checks
- `test/view-jsx-radix.test.tsx` — runtime SSR with Radix Dialog Root / Label + View.gen
- `packages/last-ts` typecheck includes those suites (`jsxImportSource: "last-ts"`)

---

## Not this

```ts
Hello.provide(View.gen(…))
yield* needs(Hello)
View.el(Parent, { children: View.el(Child) })
```
