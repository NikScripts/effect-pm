{#serve-per-hyperlink-deps title="Scenario — serve-per-hyperlink deps" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/serve-per-hyperlink-deps>.
<!-- docs-site-link:end -->
# Scenario — serve-per-hyperlink deps

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/serve-per-hyperlink-deps.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/serve-per-hyperlink-deps.ts)  
**Run:** `pnpm run example:serve-per-hyperlink-deps`  
**Hub:** [Examples → Scenarios](/docs/examples#scenarios)

## What this scenario shows

Two HyperServices need different implementations of the same dependency tag, served on one `/rpc`, isolated — proven via `/health` and per-service labels.

{.twoslash include="examples/serve-per-hyperlink-deps.ts"}
``` ts
```
