{#launcher-ready-timeout title="Launcher — Ready timeout errors" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-ready-timeout>.
<!-- docs-site-link:end -->
# Launcher — Ready timeout errors

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/ready-timeout.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/ready-timeout.ts)  
**Run:** `pnpm run example:launcher-ready-timeout`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [handle phases](/docs/launcher-handle-phases) · [minimal up](/docs/launcher-minimal-up)  
> **Guide:** [Launcher — Errors](/docs/launcher#errors-typed)

## What this shows

Typed Ready failures — match `_tag`, never message strings:

| `_tag` | When |
|--------|------|
| `ReadyTimedOut` | Bound expired (child kill-reaped; handle spent) |
| `ChildExited` | OS child died during `awaitReady` |

{.twoslash include="examples/launcher/ready-timeout.ts"}
``` ts
```
