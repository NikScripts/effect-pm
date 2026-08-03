{#view-typed-jsx title="Typed JSX (Views)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed Views — nest without re-yielding

TypeScript erases services from `<Child />` expressions. **`View.nest`** keeps
the child as a value (so `R` merges) and lets you render it with normal JSX.

Hover **`Hello`** → **`Middle`** → **`Outer`**: only Hello `yield*`s `Greeter`;
Middle/Outer only `nest` + JSX. All three should show `Greeter`.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

## Live render

```view-jsx
```

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
