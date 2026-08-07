# last.ts RSC + Router demo

Waku RSC app using **last-ts** only (not Hyperlink docs).

| | |
|--|--|
| Run | `pnpm run example:apps-last-ts-site` → `:5220` |
| Docs | [`docs/last/rsc-router.md`](../../../docs/last/rsc-router.md) — full API setup with source includes |
| Tailscale | http://100.67.32.32:5220/ |

## Layout

```
src/lib/site.ts              Router.make catalog + urls
src/islands/RouterProvider   Last.app + Waku.router(waku(Site))
src/islands/Nav              Waku Link soft-nav
src/pages/**                 Page.static / Page.build / Page.layout (RSC)
src/islands/ViewDemo         View.Service(key, default) client island
```

File routes render; the Router catalog + Waku layer soft-nav.
