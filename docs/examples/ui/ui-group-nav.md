{#ui-group-nav title="UI — GroupNav + Target" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/ui-group-nav>.
<!-- docs-site-link:end -->
# UI — GroupNav + Target

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/ui/group-nav.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/group-nav.ts)  
**Run:** `pnpm run example:ui-group-nav`  
**Hub:** [Examples → UI](/docs/examples#ui) · [Routing](/docs/routing)

## What this shows

`Group.asRoutes` → typed catalog, then `GroupNav` over a Memory router.
Each step logs the tagged `Route.TargetValue` (`_tag`, `viewOf`, `memberOf`).

{.twoslash include="examples/ui/group-nav.ts"}
``` ts
```
