{#last-ts-from-effect title="last-ts — fromEffect / groupsFromEffect" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-ts-from-effect>.
<!-- docs-site-link:end -->
# last-ts — fromEffect / groupsFromEffect

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/last/from-effect/main.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/from-effect/main.ts)  
**Run:** `pnpm run example:last-from-effect`  
**Spine:** [last-ts spine](/docs/last-ts-spine)

## Why `fromEffect`

Static `.add(Route.get(…), …)` freezes path grammar in the catalog module. Here a
**CMS Context service** (Layer-swapped) decides param/query shapes and which
groups exist — same catalog code, different live routes.

- `group.fromEffect` — destinations with different params/queries (`product`,
  `variant`, `article`)
- `groupsFromEffect` — optional top-level groups (`docs`)

Sync `R=never` Effects still materialize immediately (tooling). Effects that
`yield*` a service defer until `RouterBuilder.layer`.

{.twoslash include="examples/last/from-effect/main.ts"}
``` ts
```
