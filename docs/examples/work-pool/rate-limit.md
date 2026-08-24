{#work-pool-rate-limit title="WorkPool — rate limit" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/work-pool-rate-limit>.
<!-- docs-site-link:end -->
# WorkPool — rate limit

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/work-pool/rate-limit.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/work-pool/rate-limit.ts)  
**Run:** `pnpm run example:work-pool-rate-limit`  
**Hub:** [Examples → work-pool](/docs/examples#work-pool)

> [!NOTE]
> **Related examples:** [Gate fleet rate limit](/docs/gate-rate-limit-fleet) · [named lanes](/docs/work-pool-named-lanes)

## What this shows

Drain `rateLimit` delaying item starts independently from queue concurrency.

{.twoslash include="examples/work-pool/rate-limit.ts"}
``` ts
```
