{#node-handoff-ab-cutover title="Node — A→B handoff cutover" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-handoff-ab-cutover>.
<!-- docs-site-link:end -->
# Node — A→B handoff cutover

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/handoff-ab-cutover.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/handoff-ab-cutover.ts)  
**Run:** `pnpm run example:node-handoff-ab-cutover`  
**Hub:** [Examples → node](/docs/examples#node)  
**Guide:** [Identity coordinator — A→B cutover](/docs/identity-coordinator#ab-cutover-recipe-state-transfer)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

Locked #39 live cutover: B is Directory-visible first; A enqueues WorkPool jobs; `Node.shutdown(A)`
runs baked `WorkPool.releaseEnqueueHandoff`; pending lands on B; Directory drops A.

{.twoslash include="examples/node/handoff-ab-cutover.ts"}
``` ts
// @noErrors
```
