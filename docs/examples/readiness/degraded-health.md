{#readiness-degraded-health title="Readiness — degraded health" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/readiness-degraded-health>.
<!-- docs-site-link:end -->
# Readiness — degraded health

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/readiness/degraded-health.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/readiness/degraded-health.ts)  
**Run:** `pnpm run example:readiness-degraded-health`  
**Hub:** [Examples → readiness](/docs/examples#readiness)

> [!NOTE]
> **Related examples:** [withReadiness](/docs/readiness-with-readiness) · [Fleet health with readiness](/docs/fleet-health-with-readiness)

## What this shows

Node `/health` returns 503 when a served HyperService is not ready.

{.twoslash include="examples/readiness/degraded-health.ts"}
``` ts
```
