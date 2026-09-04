{#node-drain-yield-refuse title="Node — drain yield refuse" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-drain-yield-refuse>.
<!-- docs-site-link:end -->
# Node — drain yield refuse

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/drain-yield-refuse.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/drain-yield-refuse.ts)  
**Run:** `pnpm run example:node-drain-yield-refuse`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [askIncumbent takeover](/docs/node-ask-incumbent-takeover) · [serve handoff](/docs/node-serve-handoff) · [A→B handoff cutover](/docs/node-handoff-ab-cutover)  
> **Guide:** [Identity coordinator](/docs/identity-coordinator) · [Policy](/docs/policy) (yield / conflict)

## What this shows

`Node.drain` moves `phase` to `"draining"` while the node stays up and keeps answering
RPCs. Yield **always refuses** while draining — an `askIncumbent` newcomer gets
`IncumbentAlive` and the Directory row stays on the incumbent.

{.twoslash include="examples/node/drain-yield-refuse.ts"}
``` ts
// @noErrors
```
