{#launcher-lookup-membership-child title="Launcher — membership child" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-lookup-membership-child>.
<!-- docs-site-link:end -->
# Launcher — membership child

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/lookup-membership-child.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/lookup-membership-child.ts)  
**Run:** spawned by [lookup membership](/docs/launcher-lookup-membership)  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [Lookup membership](/docs/launcher-lookup-membership) · [askIncumbent takeover](/docs/node-ask-incumbent-takeover) · [launch shutdown](/docs/node-launch-shutdown)  
> **Guide:** [Identity coordinator — custody vs membership](/docs/identity-coordinator#custody-vs-membership-launcher--lookup)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

Child after custody: `assumeToken` + `Lookup.client` advertise, `askIncumbent` +
`onYield: false` (refuse steal), driven with `Node.launch` so remote shutdown can exit.

{.twoslash include="examples/launcher/lookup-membership-child.ts"}
``` ts
// @noErrors
```
