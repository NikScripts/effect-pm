{#view-typed-jsx title="Typed JSX (Views)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> live type previews, and the demo island — is at
> <http://100.67.32.32:5190/docs/view-typed-jsx> (Tailscale).
<!-- docs-site-link:end -->
# Typed JSX — nested View requirements

Hover **`Inner`**, then **`Middle`**, then **`Outer`**. Only Inner `yield*`s
`Greeter`. Middle and Outer have no yields — they only nest the child via typed
`jsx` / `jsxs`. All three should show `Greeter`.

## Hover these values

{.twoslash include="examples/ui/view-typed-jsx.tsx"}
``` tsx
```

TypeScript types `<Foo />` as a black-box `JSX.Element`. The `R` channel is the
`jsx` / `jsxs` call types from `last-ts/jsx-runtime` (what the JSX transform
emits).

## Live render

Same Outer → section → article → Middle → Inner, with `Greeter` provided once:

```view-jsx
```

## Opt-in

```ts
/** @jsxImportSource last-ts */
```

or `"jsxImportSource": "last-ts"` in tsconfig. See also [View Tag types](/docs/view-tag-types).
