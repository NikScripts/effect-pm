{#node-clients title="Node — clients catalog" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-clients>.
<!-- docs-site-link:end -->
# Node — clients catalog

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/node-clients.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/node-clients.ts)  
**Run:** `pnpm run example:node-clients`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

Catalog Node + `Node.clients` — one Worker advertises `Jobs | Emails`; the client dials both without repeating `connect`.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/node-clients.ts"}
``` ts
// @noErrors
```
