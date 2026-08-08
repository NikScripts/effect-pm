# Last.ts docs server (`docs/last/site`)

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng — Waku RSC docs surface  
**Not Hyperlink docs** (`docs/site` / `:5190`). Not an example app.

## Run

```bash
pnpm run docs:last-site
# → http://100.67.32.32:5220/
```

**Docs (API setup):** [`../last/rsc-router.md`](../last/rsc-router.md)
→ `/docs/rsc-router` on the Hyperlink book when mirrored.

## Shape

| Piece | Role |
|-------|------|
| `Page.make` / `Page.static` + `Page.asDefault` | RSC file page classes |
| `Last.provider(Waku.layer.pipe(Layer.provide(routes)))` | children-only soft-nav |
| `Router.make` + `Route.staticFromEffect` + `urls` | typed catalog |
| `last-ts/Waku` `Link` | soft-nav (layout island) |
| `View.Service` | client island on `/view` |

**Removed / never approved:** `Page.getConfig`, `Page.build`, Stamped theater,
`Last.app(Layer.empty).pipe(Waku.router(…)).Provider`, `RouterProvider`,
`examples/apps/last-ts-site`.
