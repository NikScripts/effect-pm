{#launcher-ready-services title="Launcher — ready services" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-ready-services>.
<!-- docs-site-link:end -->
# Launcher — ready services

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/ready-services.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/ready-services.ts)  
**Run:** `pnpm run example:launcher-ready-services`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [minimal up](/docs/launcher-minimal-up) · [Ready timeout](/docs/launcher-ready-timeout) · [withReadiness](/docs/readiness-with-readiness)  
> **Guide:** [Launcher](/docs/launcher) · [Readiness](/docs/readiness)

## What this shows

`ready.services` narrows `awaitReady` to a named HyperService subset (Tags or wire keys)
instead of allReady-shaped. Escape hatch for staged bring-up — same readiness substrate.

{.twoslash include="examples/launcher/ready-services.ts"}
``` ts
```
