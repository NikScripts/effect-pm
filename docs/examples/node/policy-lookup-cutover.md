{#node-policy-lookup-cutover title="Node — Policy lookup cutover" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-policy-lookup-cutover>.
<!-- docs-site-link:end -->
# Node — Policy lookup cutover

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/policy-lookup-cutover.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/policy-lookup-cutover.ts)  
**Run:** `pnpm run example:node-policy-lookup-cutover`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [A→B handoff cutover](/docs/node-handoff-ab-cutover) · [identity coordinator](/docs/node-identity-coordinator) · [verifyConnection](/docs/node-verify-connection)  
> **Guide:** [Policy](/docs/policy) · [Identity coordinator](/docs/identity-coordinator)

## What this shows

Composable `Policy.provide` on `lookupClient`: warm sticky while A+B dual-serve, then
`Advice.prefer(B)` early-moves the same client facade before A shuts down.

{.twoslash include="examples/node/policy-lookup-cutover.ts"}
``` ts
// @noErrors
```
