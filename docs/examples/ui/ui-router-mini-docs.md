{#ui-router-mini-docs title="UI — Router mini-docs site" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/ui-router-mini-docs>.
<!-- docs-site-link:end -->
# UI — Router mini-docs site

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/ui/router-mini-docs.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/router-mini-docs.ts)  
**Run (CLI / types):** `pnpm run example:ui-router-mini-docs`  
**Run (browser):** `pnpm run example:apps-router-docs` → <http://localhost:5189>  
**Hub:** [Examples → UI](/docs/examples#ui) · [Routing](/docs/routing) · [Apps](/docs/examples#apps)

> [!NOTE]
> **Related:** [GroupNav + Target](/docs/ui-group-nav) · browser shell
> `examples/apps/router-docs` (`example:apps-router-docs`)

## What this shows

A **docs-shaped** site catalog on `Route` + `Router` — typed `urlBuilder` /
`Router.to`, nested `guides` group, positional `/api/:symbol` (`urls.api("WorkPool")`).

The CLI prints the typed URLs and matches (including `?query`). The Vite app mounts
the same destinations with `Route.handle` + `Router.Outlet` so you can click through
a mini docs chrome.

{.twoslash include="examples/ui/router-mini-docs.ts"}
``` ts
```
