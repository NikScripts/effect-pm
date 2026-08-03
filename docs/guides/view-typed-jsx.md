{#view-typed-jsx title="Typed JSX (Views)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed JSX — nested View requirements

With `jsxImportSource: "last-ts"`, View components carry services **R**. Hover the
two values below: **`Inner`** needs `Greeter`; **`Outer`** has no `yield*` and only
nests `Inner` deep in the tree — Outer’s type still includes `Greeter`.

## Hover these two values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

## Live render

Same Outer → section → article → aside → Inner, with `Greeter` provided once:

```view-jsx
```

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
