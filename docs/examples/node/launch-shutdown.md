{#node-launch-shutdown title="Node — launch shutdown" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-launch-shutdown>.
<!-- docs-site-link:end -->
# Node — launch shutdown

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/launch-shutdown.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/launch-shutdown.ts)  
**Run:** `pnpm run example:node-launch-shutdown`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [serve handoff](/docs/node-serve-handoff) · [A→B handoff cutover](/docs/node-handoff-ab-cutover) · [Launcher minimal up](/docs/launcher-minimal-up)  
> **Guide:** [Identity coordinator](/docs/identity-coordinator) (prefer `Node.launch` over `Layer.launch`)

## What this shows

`Node.launch(node, listenLayer)` races `Layer.launch` against the shutdown latch.
`Node.shutdown` drains → leave Directory → signal the latch; the listen fiber exits
without `process.exit`. Child helpers for Launcher examples use the same pattern.

{.twoslash include="examples/node/launch-shutdown.ts"}
``` ts
// @noErrors
```
