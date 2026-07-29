{#gate-http-api-client title="Gate.HttpApiClient" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gate-http-api-client>.
<!-- docs-site-link:end -->
# Gate.HttpApiClient

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/gate-http-api-client.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/gate-http-api-client.ts)  
**Run:** `pnpm run example:gate-http-api-client`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)  
**Guide:** [Gate](/docs/gates)

## What this form shows

`Gate.HttpApiClient` Tag + nest `metrics.usage` (requests / in-flight). No sibling
ApiMetrics module — usage lives on the client handle.

{.twoslash include="examples/forms/hyperlink/gate-http-api-client.ts"}
``` ts
```
