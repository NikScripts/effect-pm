{#node-verify-connection title="Node — verifyConnection" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-verify-connection>.
<!-- docs-site-link:end -->
# Node — verifyConnection

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/verify-connection.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/verify-connection.ts)  
**Run:** `pnpm run example:node-verify-connection`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [tag-bound serve](/docs/node-tag-bound) · [Hyperlink serve + client](/docs/hyperlink-serve-client) · [Policy lookup cutover](/docs/node-policy-lookup-cutover)  
> **Guide:** [Client verify](/docs/client-verify) · [Policy](/docs/policy) (`Policy.verifyOff` / `verifyStatus` / `verifyReject`)

## What this shows

Tier-1 reachability and deep `node.status` checks. Addressed `Hyperlink.client` runs verify
by default; compose mode with `Policy.provide`.

{.twoslash include="examples/node/verify-connection.ts"}
``` ts
```
