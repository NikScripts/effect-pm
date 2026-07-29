{#apps-tui-handoff-ab-live title="Apps — A→B handoff live (Ink)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/apps-tui-handoff-ab-live>.
<!-- docs-site-link:end -->
# Apps — A→B handoff live (Ink)

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/apps/tui/handoff-ab-live.tsx`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/apps/tui/handoff-ab-live.tsx)  
**Run:** `pnpm run example:handoff-ab-live` (needs a real TTY / alt-screen)  
**Hub:** [Examples → node](/docs/examples#node) · [Apps](/docs/examples#apps)  
**Guide:** [Identity coordinator — A→B cutover](/docs/identity-coordinator#ab-cutover-recipe-state-transfer)  
**Log-only twin:** [`example:node-handoff-ab-cutover`](/docs/node-handoff-ab-cutover)

## What this shows

Dual-pane Ink TUI over Locked #39: Worker A (outgoing) vs Worker B (Directory peer).
Autoplay enqueues pending jobs on A (`autoStart: false`), then `Node.shutdown(A)` runs
baked `WorkPool.releaseEnqueueHandoff` — watch pending jump A → B and Directory drop A.

Keys: **a** enqueue · **h** handoff · Ctrl+C quit.
