{#launcher-plan-update title="Launcher — planUpdate + restartSuccessor" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-plan-update>.
<!-- docs-site-link:end -->
# Launcher — planUpdate + restartSuccessor

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/plan-update.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/plan-update.ts)  
**Run:** `pnpm run example:launcher-plan-update`  
**Hub:** [Examples → launcher](/docs/examples#launcher)  

> [!NOTE]
> **Related examples:** [Ensure Lookup first](/docs/launcher-ensure-lookup) · [Lookup membership](/docs/launcher-lookup-membership)  
> **Guide:** [Launcher — Lookup node](/docs/launcher#lookup-node-ensure-lookup-first)

## What this shows

1. `Lookup.planUpdate` fail-closed on wire removal → `UpdateBlocked`
2. Ambient `Lookup.planForce` returns the blocked impact
3. `Launcher.restartSuccessor` stops before successor spawn when the plan blocks

{.twoslash include="examples/launcher/plan-update.ts"}
``` ts
// @noErrors
```
