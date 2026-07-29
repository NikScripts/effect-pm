{#node-clients title="Node — clients catalog" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-clients>.
<!-- docs-site-link:end -->
# Node — clients catalog

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/node/clients.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/node/clients.ts)  
**Run:** `pnpm run example:node-clients`  
**Hub:** [Examples → node](/docs/examples#node)

> [!NOTE]
> **Related examples:** [tag-bound serve](/docs/node-tag-bound) · [asLookup](/docs/node-as-lookup)

Fence body `// @noErrors` covers `process` under the docs Twoslash host.

## What this shows

`Node.clients` dials multiple services without repeating connect.

{.twoslash include="examples/node/clients.ts"}
``` ts
// @noErrors
```
