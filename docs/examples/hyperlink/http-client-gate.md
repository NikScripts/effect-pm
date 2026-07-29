{#http-client-gate title="HttpClientGate" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/http-client-gate>.
<!-- docs-site-link:end -->
# HttpClientGate

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/http-client-gate.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/http-client-gate.ts)  
**Run:** `pnpm run example:http-client-gate`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)  
**Guide:** [Gate](/docs/gates)

## What this form shows

`HttpClientGate.transformClient` applies the same concurrency gate pattern as
`Gate.httpApiClient` limits — at the `HttpClient` layer. Hits jsonplaceholder with 10
parallel GETs.

{.twoslash include="examples/forms/hyperlink/http-client-gate.ts"}
``` ts
```
