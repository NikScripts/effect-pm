{#node-peers-layer-rebind title="Node — peersLayer rebind" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-peers-layer-rebind>.
<!-- docs-site-link:end -->
# Node — peersLayer rebind

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/peers-layer-rebind.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/peers-layer-rebind.ts)  
**Run:** `pnpm run example:node-peers-layer-rebind`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [askIncumbent takeover](/docs/node-ask-incumbent-takeover) · [A→B handoff cutover](/docs/node-handoff-ab-cutover)  
> **Guide:** [Identity coordinator](/docs/identity-coordinator) · [Policy](/docs/policy) (stream / dial parity)

## What this shows

Directory-mode `Hyperlink.peersLayer`: East keeps a stable `peers[West]` facade while West
moves A→B (same `nodeKey`, new dial). Folds follow build-then-swap + retry — Track D
parity with `lookupClient`.

{.twoslash include="examples/node/peers-layer-rebind.ts"}
``` ts
// @noErrors
```
