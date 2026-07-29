{#node-tag-addressed title="Node.Tag — fixed address" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/node-tag-addressed>.
<!-- docs-site-link:end -->
# Node.Tag — fixed address

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/node-tag-addressed.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/node-tag-addressed.ts)  
**Run:** `pnpm run example:node-tag-addressed`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

`Node.Tag` with a fixed `{ path }` ⇒ IpcSocket.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/node-tag-addressed.ts"}
``` ts
// @noErrors
```
