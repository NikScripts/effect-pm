{#view-typed-jsx title="Typed JSX (Views)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed JSX — nested View requirements

Hover **`Inner`** then **`Outer`**. Outer is a plain `View.stamp` (no type
parameters) around a normal `Middle` function that nests `Inner`.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

## Live render

Same Outer → section → article → Middle → Inner, with `Greeter` provided once:

```view-jsx
```

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
