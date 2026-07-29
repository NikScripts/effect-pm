{#gate-unit-and-input title="Gate — unit + input" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/gate-unit-and-input>.
<!-- docs-site-link:end -->
# Gate — unit + input

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/hyperlink/gate-unit-and-input.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/hyperlink/gate-unit-and-input.ts)  
**Run:** `pnpm run example:gate`  
**Hub:** [Examples → Hyperlink](/docs/examples#hyperlink)  
**Guide:** [Gate](/docs/gates)

## What this form shows

Two `Gate.Service` tags: a void-payload timed gate (concurrency batches) and a parameterized
`DoubleGate` with static `.run`. Fence is the runnable file; cuts hide the harness.

{.twoslash include="examples/forms/hyperlink/gate-unit-and-input.ts"}
``` ts
```
