{#last-ts-context-link title="last-ts — context / link" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-ts-context-link>.
<!-- docs-site-link:end -->
# last-ts — Last.context / Last.link

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/last/context-link/Demo.tsx`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/context-link/Demo.tsx)  
**Run:** `pnpm run example:last-context-link`  
**Lock:** [`last-context-view-lock.md`](../../handoffs/last-context-view-lock.md)

## Value

- **Views** for every component slot (leaf DOM + composition)
- **`Last.context`** groups a region (`NavBarContext`) and nests under `Site`
- **`Last.use`** in composition / `Tree` (no DOM in those layers)
- **`Last.link`**: direct home brand, group-narrowed `DocsLink`, uncalled
  `ChapterLink` (`slug` + `query` props), external `out`

{.twoslash include="examples/last/context-link/Demo.tsx"}
``` tsx
```
