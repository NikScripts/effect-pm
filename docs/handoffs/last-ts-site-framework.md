# Last.ts docs server (`docs/last/site`)

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Status:** dogfood under corrections lock  
**Not Hyperlink docs** (`docs/site` / `:5190`).

## Run

```bash
pnpm run docs:last-site
# → :5220
```

**Locks:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) ·
[`router-httpapi-lock.md`](./router-httpapi-lock.md) ·
[`../last/rsc-router.md`](../last/rsc-router.md)

## Shape

| Piece | Role |
|-------|------|
| `src/pages/**` | Plain Waku RSC default exports |
| `Router.make` + `Route.get` + `urls` | Typed catalog |
| `Last.provider(Waku.layer…)` | Soft-nav |
| `View.make` + `View.mount` | Client island on `/view` |

**Removed / never approved:** `getConfig`, `pageConfig`, `Page.asDefault`,
`Page.getConfig`, Route `fromEffect*` / `fromPage` / `*FromPages`, `View.Service`
as the mint name.
