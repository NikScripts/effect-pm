{#last-ts-from-effect title="last-ts — fromEffect / groupsFromEffect" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-ts-from-effect>.
<!-- docs-site-link:end -->
# last-ts — fromEffect / groupsFromEffect

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/last/from-effect/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/from-effect/)  
**Run:** `pnpm run example:last-from-effect`  
**Spine:** [last-ts spine](/docs/last-ts-spine)

## Type story (`cms.ts`)

Work backwards from the URL surface:

- **`SiteTree<Features>`** — conditional leaves/branches (`variants`, `docs`)
- **`UrlsOf<Node>`** — recursive nest (`docs.api.symbol`)
- **Narrow bags** — `locale: "en" | "de"`, `version: "v1" | "v2"` + query keys

Runtime walks typed const trees into `group.fromEffect` / `groupsFromEffect` on a
normal `Router.make().add` catalog. Bake `R` is `CmsEdition`.

Type tests: `test/ui-from-effect-typed.test-d.ts`.

{.twoslash include="examples/last/from-effect/cms.ts"}
``` ts
```
