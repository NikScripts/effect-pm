{#last-ts-spine title="Last.ts — spine acceptance" status="draft" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-ts-spine>.
<!-- docs-site-link:end -->
# Last.ts — spine acceptance

{.draft}
**Draft** — Twoslash SSOT for the Eng’d last-ts spine. Runnable Waku app is the package bar.

**Source (Twoslash):** [`examples/last/spine/demo.tsx`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/spine/demo.tsx)  
**Runnable app:** [`examples/last/spine/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/spine/)  
**Run:** `pnpm run example:last-spine` → `http://localhost:5230`  
**Handoff:** [`docs/handoffs/last-ts-spine.md`](../../handoffs/last-ts-spine.md) · hub: [Examples → UI](/docs/examples#ui)

## What this shows

One composition path — mint → file path → host `fromPage` → soft-nav catalog →
`Document.provide` → one `Last.provider`:

1. **`Page.static` / `Page.make`** — body + bake mode; path from the file only
2. **`Router` + `Route.get` + `RouterBuilder.handle(mint)`** — soft-nav catalog + typed `urls.*`
3. **`Document.provide`** — title + titleTransform (required); Cell via `provideMerge`
4. **`Server.fromPage(path, mint)`** — host registration only (no app `waku` / `getConfig`)

Hover types on the fence. Run the app for the live routes (`/`, `/about`, `/guides/routing`).

{.twoslash include="examples/last/spine/demo.tsx"}
``` tsx
```
