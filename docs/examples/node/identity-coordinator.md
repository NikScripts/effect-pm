{#node-identity-coordinator title="Node — identity coordinator" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-identity-coordinator>.
<!-- docs-site-link:end -->
# Node — identity coordinator

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/identity-coordinator.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/identity-coordinator.ts)  
**Run:** `pnpm run example:node-identity-coordinator`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [asLookup](/docs/node-as-lookup) · [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [Launcher Lookup membership](/docs/launcher-lookup-membership)  
> **Guide:** [Identity coordinator](/docs/identity-coordinator) · [Policy](/docs/policy)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

Lookup planes: Identity (Router winner), Directory (workers), Advice prefer. Sibling
imports — `import * as Advice from "hyperlink-ts/Advice"` — never `Lookup.Advice.*`.

{.twoslash include="examples/node/identity-coordinator.ts"}
``` ts
// @noErrors
```
