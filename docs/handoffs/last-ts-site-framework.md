# Last.ts RSC site demo

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng — Waku RSC  
**Not Hyperlink docs** (`docs/site` / `:5190`).

## Run

```bash
pnpm run example:apps-last-ts-site
# → http://100.67.32.32:5220/
```

**Docs (API setup + source includes):** [`../last/rsc-router.md`](../last/rsc-router.md)
→ `/docs/rsc-router` on the docs site.

## Shape

| Piece | Role |
|-------|------|
| `src/pages/**` | **RSC** file routes (plain Waku modules) |
| `Last.provider(Waku.fromApi(Site))` | children-only soft-nav provider |
| `Router.make` + `urls` | typed catalog |
| `last-ts/Waku` `Link` | soft-nav (layout island) |
| `View.Service` | client island on `/view` |

**Removed / never approved:** `Page.getConfig`, Stamped default-export theater,
`Last.app(Layer.empty).pipe(Waku.router(…)).Provider`, `RouterProvider` wrapper.

File routes = render SSOT. Catalog (`Site`) is typed urls only. Soft-nav verified
via Waku `Link` (URL + RSC page swap). `Page.Service` / `createPages` still
deferred — do not invent interim `getConfig` bridges.
