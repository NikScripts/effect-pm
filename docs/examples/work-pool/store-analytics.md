{#work-pool-store-analytics title="WorkPool — store analytics" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/work-pool-store-analytics>.
<!-- docs-site-link:end -->
# WorkPool — store analytics

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/work-pool/store-analytics.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/work-pool/store-analytics.ts)  
**Run:** `pnpm run example:work-pool-store-analytics`  
**Hub:** [Examples → work-pool](/docs/examples#work-pool)

## What this shows

`WorkPool.store(tag)` soft analytics: `stats`, `failureRate`, `slowest`, `latency`, and `lastFailure`.

{.twoslash include="examples/work-pool/store-analytics.ts"}
``` ts
```
