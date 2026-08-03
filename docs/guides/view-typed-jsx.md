{#view-typed-jsx title="Typed JSX (Views)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <https://dev.hyperlink.cool/docs/view-typed-jsx>
> (local Tailscale: <http://100.67.32.32:5190/docs/view-typed-jsx>).
<!-- docs-site-link:end -->
# Typed JSX — nested View requirements

React’s default JSX types erase what a tree needs. With
`jsxImportSource: "last-ts"`, nested JSX keeps services **R**:
**child → parent → the component function**.

No slots, no catalog, no `View.el` — normal nesting:

```tsx
const Component = () => (
  <Parent>
    <Child />
  </Parent>
)
```

## Live demo

Renders `View.gen` children under a shadcn-style Radix `Dialog` wrapper, with
`Greeter` + `Clock` provided once at the app Layer:

```view-jsx
```

## Types (hover the queries)

Persistent `^?` queries on the same source as the island. Confirm
`PageNeeds` / `TreeNeeds` / `ThroughRadixNeeds` include the child Tags — including
through the outside Radix wrapper:

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

## Opt-in

Per file:

```ts
/** @jsxImportSource last-ts */
```

Or tsconfig:

```json
{ "jsx": "react-jsx", "jsxImportSource": "last-ts" }
```

Runtime still emits React elements. Plain / Radix / shadcn components stay valid;
they contribute `never` to `R`, and **children** still bubble.

See also [View Tag types](/docs/view-tag-types).
