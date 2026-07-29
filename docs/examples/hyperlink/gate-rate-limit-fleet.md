{#gate-rate-limit-fleet title="Gate — fleet rate limit" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gate-rate-limit-fleet>.
<!-- docs-site-link:end -->
# Gate — fleet rate limit

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/gate-rate-limit-fleet.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/gate-rate-limit-fleet.ts)  
**Run:** `pnpm run example:gate-rate-limit-fleet`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)  
**Guide:** [Gate](/docs/gates)

## What this form shows

Two Gate scopes share one `RateLimiterStore`. Prefers Redis when `REDIS_URL` / localhost
answers PING; otherwise in-memory (same-process stand-in). See the module header in the
source for compose commands.

{.twoslash include="examples/forms/hyperlink/gate-rate-limit-fleet.ts"}
``` ts
```
