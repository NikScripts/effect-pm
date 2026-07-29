{#shared-tag-wire title="Hyperlink — shared Spec wire" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/shared-tag-wire>.
<!-- docs-site-link:end -->
# Hyperlink — shared Spec wire

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/shared-tag-wire.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/shared-tag-wire.ts)  
**Run:** `pnpm run example:shared-tag-wire`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

Shared Spec tags — one Spec / RpcGroup, many instance keys, routed by the per-call `key` header.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/shared-tag-wire.ts"}
``` ts
// @noErrors
```
