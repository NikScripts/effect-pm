{#workpool-priority-lanes title="WorkPool — Priority Lanes" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/workpool-priority-lanes>.
<!-- docs-site-link:end -->
# WorkPool — Priority Lanes

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/workpool-priority-lanes.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/queue/workpool-priority-lanes.ts)  
**Run:** `pnpm run example:workpool-priority`  
**Hub:** [Examples → Queue](/docs/examples#queue)

`WorkPool` — N named lanes, `add(item, lane?)`, and `sizes: Record<string, number>`.

The fence is the runnable file. Fence-body `// @noErrors` is a known prerender-only quirk
(typechecks clean under `tsx` / `check-twoslash`; remove when the waku-build holdout is fixed).

{.twoslash include="examples/forms/queue/workpool-priority-lanes.ts"}
``` ts
// @noErrors
```
