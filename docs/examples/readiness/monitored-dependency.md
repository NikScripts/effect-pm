{#readiness-monitored-dependency title="Readiness — monitored dependency" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/readiness-monitored-dependency>.
<!-- docs-site-link:end -->
# Readiness — monitored dependency

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/readiness/monitored-dependency.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/readiness/monitored-dependency.ts)  
**Run:** `pnpm run example:readiness-monitored-dependency`  
**Hub:** [Examples → readiness](/docs/examples#readiness)

> [!NOTE]
> **Related examples:** [withReadiness](/docs/readiness-with-readiness) · [degraded health](/docs/readiness-degraded-health)

## What this shows

`Hyperlink.monitoredDependency` builds status, changes, and readiness together.

{.twoslash include="examples/readiness/monitored-dependency.ts"}
``` ts
```
