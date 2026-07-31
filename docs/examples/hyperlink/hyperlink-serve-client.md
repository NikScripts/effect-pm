{#hyperlink-serve-client title="Hyperlink — serve and client" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/hyperlink-serve-client>.
<!-- docs-site-link:end -->
# Hyperlink — serve and client

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/hyperlink/serve-client.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/hyperlink/serve-client.ts)  
**Run:** `pnpm run example:hyperlink-serve-client`  
**Hub:** [Examples → hyperlink](/docs/examples#hyperlink-tag--wire)

> [!NOTE]
> **Related examples:** [WorkPool serve + client](/docs/work-pool-serve-client) · [Daemon serve + client](/docs/daemon-serve-client) · [counter layer](/docs/hyperlink-counter-layer)

## What this shows

The same Counter Tag served over a local RPC node and consumed through `Node.clients`.

{.twoslash include="examples/hyperlink/serve-client.ts"}
``` ts
```
