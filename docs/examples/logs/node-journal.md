{#logs-node-journal title="Logs — node journal" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/logs-node-journal>.
<!-- docs-site-link:end -->
# Logs — node journal

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/logs/node-journal.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/logs/node-journal.ts)  
**Run:** `pnpm run example:logs-node-journal`  
**Hub:** [Examples → logs](/docs/examples#logs)

> [!NOTE]
> **Related examples:** [live bus](/docs/logs-live-bus) · [Hyperlink export](/docs/logs-hyperlink-logs) · [one store, many regs](/docs/store-one-store-many-regs)

## What this shows

`Node.logs` on `Store.Service` plus durable readback through `Logs.byNode`.

{.twoslash include="examples/logs/node-journal.ts"}
``` ts
```
