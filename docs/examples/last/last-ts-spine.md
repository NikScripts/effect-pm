{#last-ts-spine title="Last.ts — spine acceptance" status="draft" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> Rendered docs (Tailscale):
> <http://100.67.32.32:5192/docs/last-ts-spine>
<!-- docs-site-link:end -->
# Last.ts — spine acceptance

{.draft}
**Draft** — Twoslash fences include the runnable spine under `examples/last/spine/src/`.

**App:** [`examples/last/spine/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/spine/)  
**Handoff:** [`docs/handoffs/last-ts-spine.md`](../../handoffs/last-ts-spine.md) · hub: [Examples → UI](/docs/examples#ui)

## Layout

```text
examples/last/spine/src/
  pages/
    index.tsx              Page.static  → /
    about.tsx              Page.make(Effect) → /about
    guides/[slug].tsx      Page.static + params → /guides/[slug]
  lib/
    site.ts                Router catalog + RouterBuilder.handle(mint)
    document.tsx           Document.provide
    Provider.tsx           Last.provider (provideMerge Document.Cell)
  paths.gen.ts             fileRouter unions (committed)
```

Waku `createPages` / `waku.server.tsx` / `_root.tsx` are **not** product surface — deleted from this demo.

## 1. Page mints — path from the file only

### Home (`/`)

{.twoslash include="examples/last/spine/src/pages/index.tsx"}
``` tsx
```

### About (`/about`) — Effect body

{.twoslash include="examples/last/spine/src/pages/about.tsx"}
``` tsx
```

### Chapter (`/guides/[slug]`) — nested params

{.twoslash include="examples/last/spine/src/pages/guides/[slug].tsx"}
``` tsx
```

## 2. Soft-nav catalog

Typed `urls.*` + `RouterBuilder.handle(mint)`. Paths align with `paths.gen`.

{.twoslash include="examples/last/spine/src/lib/site.ts"}
``` ts
```

## 3. Document.provide

`title` + `titleTransform` required.

{.twoslash include="examples/last/spine/src/lib/document.tsx"}
``` tsx
```

## 4. Last.provider

`Layer.provideMerge` keeps `Document.Cell` in the Layer output (plain `provide` drops it).
Transport is a Layer swap (`Waku` / `History` / `Memory`).

{.twoslash include="examples/last/spine/src/lib/Provider.tsx"}
``` tsx
```
