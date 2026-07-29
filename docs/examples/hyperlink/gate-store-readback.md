{#gate-store-readback title="Gate — store readback" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gate-store-readback>.
<!-- docs-site-link:end -->
# Gate — store readback

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/gate-store-readback.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/gate-store-readback.ts)  
**Run:** `pnpm run example:gate-store-readback`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)  
**Guides:** [Gate](/docs/gates) · [Stores](/docs/stores)

## What this form shows

Gate auto-writes run facts + state history; read them back via `Gate.store` on an app
`Store.Service` (`DemoStore.layerMemory`).

{.twoslash include="examples/forms/hyperlink/gate-store-readback.ts"}
``` ts
```
