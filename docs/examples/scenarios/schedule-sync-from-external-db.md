{#schedule-sync-from-external-db title="Scenario — schedule sync from DB" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/schedule-sync-from-external-db>.
<!-- docs-site-link:end -->
# Scenario — schedule sync from DB

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/scenarios/schedule-sync-from-external-db.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/scenarios/schedule-sync-from-external-db.ts)  
**Run:** `pnpm run example:schedule-control-db-sync`  
**Hub:** [Examples → Scenarios](/docs/examples#scenarios)

## What this scenario shows

External DB rows → Daemon schedule entries, synced at startup and each tick.

{.twoslash include="examples/scenarios/schedule-sync-from-external-db.ts"}
``` ts
```
