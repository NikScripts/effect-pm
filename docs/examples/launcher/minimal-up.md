{#launcher-minimal-up title="Launcher — minimal up" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-minimal-up>.
<!-- docs-site-link:end -->
# Launcher — minimal up

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/minimal-up.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/minimal-up.ts)  
**Run:** `pnpm run example:launcher-minimal-up`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [handle phases](/docs/launcher-handle-phases) · [token injection](/docs/launcher-token-injection) · [Lookup membership](/docs/launcher-lookup-membership)  
> **Guide:** [Launcher](/docs/launcher)

## What this shows

`Launcher.up` = spawn → Ready → `Node.assume` handoff → launcher exits. Custody only —
Directory membership is the child’s job afterward.

{.twoslash include="examples/launcher/minimal-up.ts"}
``` ts
```
