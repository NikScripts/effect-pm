{#launcher-ensure-lookup title="Launcher — ensure Lookup first" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-ensure-lookup>.
<!-- docs-site-link:end -->
# Launcher — ensure Lookup first

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/ensure-lookup.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/ensure-lookup.ts)  
**Run:** `pnpm run example:launcher-ensure-lookup`  
**Hub:** [Examples → launcher](/docs/examples#launcher)  

> [!NOTE]
> **Related examples:** [Lookup membership](/docs/launcher-lookup-membership) · [Minimal up](/docs/launcher-minimal-up) · [Lookup.follow handoff](/docs/node-lookup-follow-handoff)  
> **Guide:** [Launcher — Lookup node](/docs/launcher#lookup-node-ensure-lookup-first)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

`Launcher.ensureLookup` before app units:

1. Lookup already answering → **adopt** (no second spawn)
2. Not answering → spawn **Lookup-only** child → Ready → `Node.assume`
3. App worker dials via `Lookup.clientOptions` — **no Soft-bake** on the app node

{.twoslash include="examples/launcher/ensure-lookup.ts"}
``` ts
// @noErrors
```
