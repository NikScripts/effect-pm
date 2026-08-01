{#ui-file-router-dream title="UI — File router dream API" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/ui-file-router-dream>.
<!-- docs-site-link:end -->
# UI — File router dream API

{.draft}
**Draft** — teaching sketch; not package exports yet.

**Source:** [`examples/ui/file-router/dream-api.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/ui/file-router/dream-api.ts)  
**Run:** `pnpm exec tsx examples/ui/file-router/dream-api.ts`  
**Handoff:** [file-router prototype](/docs/handoffs/file-router-prototype)

## What you’re looking at

Three concerns, three tools — don’t smash them into Waku’s `getConfig`:

1. **Page mark** — is this path Static, Dynamic, or Build (+ SSG paths)?
2. **Route catalog** — typed `urls.chapter("routing")` for soft-nav
3. **View skins** — `View.provide` / camelCase `layer` for Tags used *inside* the page

{.twoslash include="examples/ui/file-router/dream-api.ts"}
``` ts
```
