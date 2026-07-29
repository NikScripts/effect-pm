{#node-lookup title="Node — asLookup" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-lookup>.
<!-- docs-site-link:end -->
# Node — asLookup

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/node-lookup.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/node-lookup.ts)  
**Run:** `pnpm run example:node-lookup`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

`Node.asLookup` brands a Tag node as the Lookup server; serve with `Lookup.layerNode`, dial with `Lookup.client`.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/node-lookup.ts"}
``` ts
// @noErrors
```
