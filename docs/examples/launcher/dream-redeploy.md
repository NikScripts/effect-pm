{#launcher-dream-redeploy title="Launcher — dream redeploy (file-swap v1→v2)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-dream-redeploy>.
<!-- docs-site-link:end -->
# Launcher — dream redeploy (file-swap v1→v2)

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/dream-redeploy.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy.ts)  
**Workers:** [`dream-redeploy-worker.v1.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v1.ts) · [`dream-redeploy-worker.v2.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-worker.v2.ts)  
**Shared:** [`dream-redeploy-shared.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/dream-redeploy-shared.ts)  
**Run:** `pnpm run example:launcher-dream-redeploy`  
**Suite:** `test/launcher-dream-redeploy.test.ts`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [restartSuccessor live A→B](/docs/launcher-restart-successor) · [Policy lookup cutover](/docs/node-policy-lookup-cutover) · [A→B handoff cutover](/docs/node-handoff-ab-cutover)  
> **Guide:** [Launcher](/docs/launcher) · [Policy](/docs/policy)

## What this shows

1. Copy v1 onto `dream-redeploy-worker.active.ts`; `Launcher.up(A)` loads that file
2. Sticky `lookupClient` reads `Probe.tip === "v1"`; enqueue WorkPool jobs on A
3. **File-swap** the same active path to v2 (A keeps v1 in memory)
4. `Launcher.restartSuccessor` ups B from the swapped path (loads v2), prefers B, shuts A
5. Directory dial moves (same `nodeKey`); sticky tip becomes `"v2"`
6. WorkPool pending transfers with **exact** payloads (baked `releaseEnqueueHandoff`)

{.twoslash include="examples/launcher/dream-redeploy.ts"}
``` ts
// @noErrors
```
