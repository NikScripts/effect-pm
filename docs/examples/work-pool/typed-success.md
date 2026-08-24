{#work-pool-typed-success title="WorkPool — typed success" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/work-pool-typed-success>.
<!-- docs-site-link:end -->
# WorkPool — typed success

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/work-pool/typed-success.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/work-pool/typed-success.ts)  
**Run:** `pnpm run example:work-pool-typed-success`  
**Hub:** [Examples → work-pool](/docs/examples#work-pool)

> [!NOTE]
> **Related examples:** [priority, dedup, retry](/docs/work-pool-priority-retry) · [Daemon typed Failed.error](/docs/daemon-typed-failed-error) · [Daemon result ref](/docs/daemon-result-ref)

## What this shows

Declaring a `success` schema on a queue Tag and reading typed `Completed.success`.

{.twoslash include="examples/work-pool/typed-success.ts"}
``` ts
```
