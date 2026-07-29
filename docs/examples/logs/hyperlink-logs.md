{#logs-hyperlink-logs title="Logs — Hyperlink export" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/logs-hyperlink-logs>.
<!-- docs-site-link:end -->
# Logs — Hyperlink export

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/logs/hyperlink-logs.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/logs/hyperlink-logs.ts)  
**Run:** `pnpm run example:logs-hyperlink-logs`  
**Hub:** [Examples → logs](/docs/examples#logs)

> [!NOTE]
> **Related examples:** [node journal](/docs/logs-node-journal) · [lineage scope](/docs/logs-lineage-scope) · [WorkPool priority retry](/docs/work-pool-priority-retry)

## What this shows

`Hyperlink.logs(tag).stream` and `.query` with a WorkPool producer.

{.twoslash include="examples/logs/hyperlink-logs.ts"}
``` ts
```
