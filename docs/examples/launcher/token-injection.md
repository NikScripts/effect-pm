{#launcher-token-injection title="Launcher — token injection" status="draft" appliesTo=node}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/launcher-token-injection>.
<!-- docs-site-link:end -->
# Launcher — token injection

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/launcher/token-injection.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/launcher/token-injection.ts)  
**Run:** `pnpm run example:launcher-token-injection`  
**Hub:** [Examples → launcher](/docs/examples#launcher)

> [!NOTE]
> **Related examples:** [minimal up](/docs/launcher-minimal-up) · [ready-worker child](/docs/launcher-ready-worker-child)  
> **Guide:** [Launcher](/docs/launcher) (`Launcher.command` / `token: "env" | "argv" | "both"`)

## What this shows

How the assume token reaches the child — `Launcher.command(…, { token: "env" })` (default)
vs `"argv"` / `"both"`. Wire protocol is still `Node.assume({ token })`; injection is app choice.

{.twoslash include="examples/launcher/token-injection.ts"}
``` ts
```
