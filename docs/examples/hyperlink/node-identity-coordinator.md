{#node-identity-coordinator title="Node — identity coordinator" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-identity-coordinator>.
<!-- docs-site-link:end -->
# Node — identity coordinator

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/node-identity-coordinator.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/node-identity-coordinator.ts)  
**Run:** `pnpm run example:node-identity-coordinator`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

One brain, many hands — identity Router (exclusive) + Workers (directory advertise) + Lookup placement advice.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/node-identity-coordinator.ts"}
``` ts
// @noErrors
```
