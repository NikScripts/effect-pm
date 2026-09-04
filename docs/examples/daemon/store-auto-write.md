{#daemon-store-auto-write title="Daemon — Soft store auto-write" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/daemon-store-auto-write>.
<!-- docs-site-link:end -->
# Daemon — Soft store auto-write

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/daemon/store-auto-write.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/daemon/store-auto-write.ts)  
**Run:** `pnpm run example:daemon-store-auto-write`  
**Hub:** [Examples → daemon](/docs/examples#daemon)

> [!NOTE]
> **Related examples:** [typed Failed.error](/docs/daemon-typed-failed-error) · [Soft override WorkPool](/docs/store-soft-override-work-pool) · [one store, many regs](/docs/store-one-store-many-regs)

## What this shows

`Daemon.layer` + `Daemon.store(tag)` Soft journals on terminal ticks.

{.twoslash include="examples/daemon/store-auto-write.ts"}
``` ts
```
