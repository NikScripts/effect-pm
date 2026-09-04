{#store-one-store-many-regs title="Store — one store, many registrations" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/store-one-store-many-regs>.
<!-- docs-site-link:end -->
# Store — one store, many registrations

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/store/one-store-many-regs.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/store/one-store-many-regs.ts)  
**Run:** `pnpm run example:store-one-store-many-regs`  
**Hub:** [Examples → store](/docs/examples#store)

> [!NOTE]
> **Related examples:** [Soft override WorkPool](/docs/store-soft-override-work-pool) · [Logs node journal](/docs/logs-node-journal) · [Daemon Soft auto-write](/docs/daemon-store-auto-write)

## What this shows

`Node.logs`, `WorkPool.store`, and `Daemon.store` on one `Store.Service`.

{.twoslash include="examples/store/one-store-many-regs.ts"}
``` ts
```
