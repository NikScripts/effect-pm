# Last.ts docs server (`docs/last/site`)

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Status:** dogfood under corrections + spine  
**Spine:** [`last-ts-spine.md`](./last-ts-spine.md)  
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
| `waku.server.tsx` | `Server.fromPage(path, mint)` registration |
| `paths.gen.ts` | fileRouter path table |
| `Router.make` + `Route.get` + `urls` | Typed soft-nav catalog |
| `Last.provider(…)` | Soft-nav + Document cell |
| `View.make` + `View.mount` | Client island on `/view` |

**Removed / never approved:** `getConfig`, `pageConfig`, `Page.asDefault`,
`Page.getConfig`, Route `fromEffect*` / `fromPage` / `*FromPages`, app `waku` imports.
