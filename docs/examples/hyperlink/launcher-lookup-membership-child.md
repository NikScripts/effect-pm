{#launcher-lookup-membership-child title="Launcher — membership child" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-lookup-membership-child>.
<!-- docs-site-link:end -->
# Launcher — membership child

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/launcher-lookup-membership-child.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/launcher-lookup-membership-child.ts)  
**Run:** spawned by [`example:launcher-lookup-membership`](/docs/launcher-lookup-membership)  
(`tsx examples/forms/hyperlink/launcher-lookup-membership-child.ts <port> <lookup-sock>`)  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

Child process for the membership demo — Track A custody (`assumeToken`) then Track B Lookup advertise. Prefer running the parent script.

Fence body `// @noErrors` covers `process.pid` / `process.argv` under the docs Twoslash host (`types: []`).

{.twoslash include="examples/forms/hyperlink/launcher-lookup-membership-child.ts"}
``` ts
// @noErrors
```
