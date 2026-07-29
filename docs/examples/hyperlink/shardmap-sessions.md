{#shardmap-sessions title="ShardMap — sessions" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/shardmap-sessions>.
<!-- docs-site-link:end -->
# ShardMap — sessions

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/shardmap-sessions.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/shardmap-sessions.ts)  
**Run:** `pnpm run example:shardmap-sessions`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)

## What this form shows

`ShardMap` routes get/put to the owning node via peers; leaf ops stay local; fleet folds
report shard sizes. Sticky partition keeps East / West traffic visible in the demo.

{.twoslash include="examples/forms/hyperlink/shardmap-sessions.ts"}
``` ts
```
