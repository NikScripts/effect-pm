{#launcher-handle-phases title="Launcher — handle phases" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-handle-phases>.
<!-- docs-site-link:end -->
# Launcher — handle phases

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/handle-phases.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/handle-phases.ts)  
**Run:** `pnpm run example:launcher-handle-phases`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [minimal up](/docs/launcher-minimal-up) · [Ready timeout errors](/docs/launcher-ready-timeout) · [token injection](/docs/launcher-token-injection)  
> **Guide:** [Launcher — Handle phases](/docs/launcher#handle-phases)

## What this shows

Explicit `Launcher.spawn` → `Handle.awaitReady` → `Handle.handoff` / `Handle.kill`.
Phases are single-flight; after handoff or kill the handle is spent (`HandleSpent`).

{.twoslash include="examples/launcher/handle-phases.ts"}
``` ts
```
