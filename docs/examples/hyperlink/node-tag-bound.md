{#node-tag-bound title="Node — Tag-bound serve" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-tag-bound>.
<!-- docs-site-link:end -->
# Node — Tag-bound serve

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/node-tag-bound.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/node-tag-bound.ts)  
**Run:** `pnpm run example:node-tag-bound`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

Tag carries the node — `Node.unix(Jobs, impl)` + `Hyperlink.client(Jobs)` via `Hyperlink.andNode`.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/node-tag-bound.ts"}
``` ts
// @noErrors
```
