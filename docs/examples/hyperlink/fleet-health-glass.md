{#fleet-health-glass title="FleetHealth — fleet glass" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/fleet-health-glass>.
<!-- docs-site-link:end -->
# FleetHealth — fleet glass

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/fleet-health-glass.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/fleet-health-glass.ts)  
**Run:** `pnpm run example:fleet-health-glass`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

Elevated `FleetHealth` — leaf `local` for this node, fleet `byNode` / `status` via peers.
A down peer is `Unreachable`, not a silent omit.

{.twoslash include="examples/forms/hyperlink/fleet-health-glass.ts"}
``` ts
```
