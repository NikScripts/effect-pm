{#node-ask-incumbent-takeover title="Node — askIncumbent takeover" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-ask-incumbent-takeover>.
<!-- docs-site-link:end -->
# Node — askIncumbent takeover

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/ask-incumbent-takeover.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/ask-incumbent-takeover.ts)  
**Run:** `pnpm run example:node-ask-incumbent-takeover`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [drain yield refuse](/docs/node-drain-yield-refuse) · [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [Launcher Lookup membership](/docs/launcher-lookup-membership)  
> **Guide:** [Policy](/docs/policy) · [Identity coordinator](/docs/identity-coordinator)

## What this shows

Same `nodeKey`, new dial: Lookup `onConflict: "askIncumbent"` + `Policy.yieldAccept`
lets the newcomer replace the Directory row. `Policy.yieldRefuse` blocks a steal with
`IncumbentAlive`. Membership plane only — not Launcher custody handoff.

{.twoslash include="examples/node/ask-incumbent-takeover.ts"}
``` ts
// @noErrors
```
