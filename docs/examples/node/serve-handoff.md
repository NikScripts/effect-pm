{#node-serve-handoff title="Node — serve handoff" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-serve-handoff>.
<!-- docs-site-link:end -->
# Node — serve handoff

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/serve-handoff.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/serve-handoff.ts)  
**Run:** `pnpm run example:node-serve-handoff`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [A→B handoff cutover](/docs/node-handoff-ab-cutover) (WorkPool bake) · [drain yield refuse](/docs/node-drain-yield-refuse) · [launch shutdown](/docs/node-launch-shutdown)  
> **Guide:** [Identity coordinator — A→B cutover](/docs/identity-coordinator#ab-cutover-recipe-state-transfer)

## What this shows

Custom `Hyperlink.serve(Tag, impl, { handoff })` — Locked #39 migration fn. With no
Directory peer, `Node.shutdown` fails `HandoffDeferred` (`reason: "NoPeer"`) and the
node stays up (`phase: "running"`). Match `_tag` / `.reason`, never message strings.

Not Launcher `Handle.handoff` (custody) and not WorkPool’s baked `releaseEnqueueHandoff`.

{.twoslash include="examples/node/serve-handoff.ts"}
``` ts
// @noErrors
```
