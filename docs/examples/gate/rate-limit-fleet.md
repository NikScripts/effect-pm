{#gate-rate-limit-fleet title="Gate — fleet rate limit" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gate-rate-limit-fleet>.
<!-- docs-site-link:end -->
# Gate — fleet rate limit

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/gate/rate-limit-fleet.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/gate/rate-limit-fleet.ts)  
**Run:** `pnpm run example:gate-rate-limit-fleet`  
**Hub:** [Examples → gate](/docs/examples#gate)

## What this shows

Two Gates share one RateLimiterStore (Redis or memory).

{.twoslash include="examples/gate/rate-limit-fleet.ts"}
``` ts
```
