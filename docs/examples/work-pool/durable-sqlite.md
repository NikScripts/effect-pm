{#work-pool-durable-sqlite title="WorkPool — durable SQLite" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/work-pool-durable-sqlite>.
<!-- docs-site-link:end -->
# WorkPool — durable SQLite

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/work-pool/durable-sqlite.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/work-pool/durable-sqlite.ts)  
**Run:** `pnpm run example:work-pool-durable-sqlite`  
**Hub:** [Examples → work-pool](/docs/examples#work-pool)

> [!NOTE]
> **Related examples:** [durable and Soft planes](/docs/store-durable-and-soft) · [Store SQLite](/docs/store-sqlite) · [store analytics](/docs/work-pool-store-analytics)

## What this shows

`SQLiteDurableWorkPoolStore` preserving pending work across a rebuilt queue layer.

{.twoslash include="examples/work-pool/durable-sqlite.ts"}
``` ts
```
