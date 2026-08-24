{#node-lookup-follow-handoff title="Node — Lookup.follow ownership handoff" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-lookup-follow-handoff>.
<!-- docs-site-link:end -->
# Node — Lookup.follow ownership handoff

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/lookup-follow-handoff.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/lookup-follow-handoff.ts)  
**Run:** `pnpm run example:node-lookup-follow-handoff`  
**Hub:** [Examples → node](/docs/examples#node)  

> [!NOTE]
> **Related examples:** [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [A→B handoff cutover](/docs/node-handoff-ab-cutover) · [asLookup](/docs/node-as-lookup)  
> **Guide:** [Policy — Lookup.follow](/docs/policy#lookupfollow-same-address-lookup-ab) · [Identity coordinator](/docs/identity-coordinator)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

**Lookup A→B on one address** — orchestrator sequences sock ownership; dialers keep
`Lookup.follow` across the gap. Not WorkPool migration, not dual Lookup endpoints,
not Launcher custody `Handle.handoff`.

1. Lookup A binds `lookup.sock`
2. Dialers use `Lookup.follow` + `Policy.StreamGap` (same path before & after)
3. Orchestrator forks B bind-with-retry, then releases A
4. B binds; follow reinstalls; Identity works on a **cold** registry

{.twoslash include="examples/node/lookup-follow-handoff.ts"}
``` ts
// @noErrors
```
