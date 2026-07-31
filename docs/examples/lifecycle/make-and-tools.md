{#lifecycle-make-and-tools title="Lifecycle — make + tools" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle-make-and-tools>.
<!-- docs-site-link:end -->
# Lifecycle — make + tools

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/lifecycle/make-and-tools.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/lifecycle/make-and-tools.ts)  
**Run:** `pnpm run example:lifecycle-make-and-tools`  
**Hub:** [Examples → Lifecycle](/docs/examples#lifecycle)

> [!NOTE]
> **Related:** [Lifecycle guide](/docs/lifecycle) · [WorkPool refill / deferStart](/docs/work-pool-refill) · [A→B handoff](/docs/handoff-ab-cutover)

## What this shows

`Hyperlink.deferStart` keeps a WorkPool Idle; `Lifecycle.from` / `of` drive start /
pause / resume; badge SSOT is `lifecycle._tag`; control verb `stop` awaits Off.

{.twoslash include="examples/lifecycle/make-and-tools.ts"}
``` ts
```
