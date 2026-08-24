# Last.ts docs server (`docs/last/site`)

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Status:** dogfood — View kits in `ui/` + Twoslash on [`rsc-router.md`](../last/rsc-router.md)  
**Spine:** [`last-ts-spine.md`](./last-ts-spine.md)  
**Context lock:** [`last-context-view-lock.md`](./last-context-view-lock.md)  
**Not Hyperlink docs** (`docs/site` / `:5190`) — that site uses the same host boundary.

## Run

```bash
pnpm run docs:last-site
# → :5220
```

## Shape

| Piece | Role |
|-------|------|
| `src/pages/**` | `Page.make` / `Page.static` class exports |
| `waku.server.tsx` | Host RSC registration (not product API) |
| `paths.gen.ts` | fileRouter path table |
| `lib/Catalog.ts` + `Router.link` | Typed soft-nav urls / Link |
| `Site.context(SiteKit)` + `Last.provideContext` | Kit debt + fulfill |
| `Last.provider(layer)` | Soft-nav + Document cell |
| `ui/*` View kits | Leaf HTML; `Tree` composition via `Last.use` |

**Removed / never approved:** `getConfig`, `pageConfig`, `Page.asDefault`,
`View.mount`, Route `fromEffect*` / `fromPage` / `*FromPages`, app `waku` imports,
`Last.provider(layer, SiteKit)` at the app edge.
