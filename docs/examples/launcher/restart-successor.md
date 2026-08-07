{#launcher-restart-successor title="Launcher — restartSuccessor live A→B" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-restart-successor>.
<!-- docs-site-link:end -->
# Launcher — restartSuccessor live A→B

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/restart-successor.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/restart-successor.ts)  
**Child:** [`examples/launcher/restart-successor-child.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/restart-successor-child.ts)  
**Run:** `pnpm run example:launcher-restart-successor`  
**Hub:** [Examples → launcher](/docs/examples#launcher)  

> [!NOTE]
> **Related examples:** [planUpdate (blocked)](/docs/launcher-plan-update) · [Lookup membership](/docs/launcher-lookup-membership) · [Ensure Lookup first](/docs/launcher-ensure-lookup)  
> **Guide:** [Launcher — Lookup node](/docs/launcher#lookup-node-ensure-lookup-first)

## What this shows

1. `Launcher.up` brings A Ready and Directory-visible
2. `Launcher.restartSuccessor` plans (ok), ups B on a new dial, shuts A down
3. Same-`nodeKey` Directory dial-replace (`askIncumbent` + yield on the child)
4. B answers `ping`

{.twoslash include="examples/launcher/restart-successor.ts"}
``` ts
// @noErrors
```
