{#launcher-ready-worker-child title="Launcher — ready worker child" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-ready-worker-child>.
<!-- docs-site-link:end -->
# Launcher — ready worker child

{.draft}
**Draft** — child helper for Launcher examples.

**Source:** [`examples/launcher/ready-worker-child.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/ready-worker-child.ts)  
**Run:** `pnpm run example:launcher-ready-worker-child`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [minimal up](/docs/launcher-minimal-up) · [token injection](/docs/launcher-token-injection) · [handle phases](/docs/launcher-handle-phases)  
> **Guide:** [Launcher](/docs/launcher)

## What this shows

Shared child for Launcher demos: `serve-env` / `serve-argv` arm `assumeToken`, serve Jobs
(+ optional Cache), and `Node.launch` the listen so shutdown can end the process.

{.twoslash include="examples/launcher/ready-worker-child.ts"}
``` ts
```
