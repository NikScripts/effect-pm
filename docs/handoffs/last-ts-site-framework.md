# Last.ts RSC site demo

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng — Waku RSC  
**Not Hyperlink docs** (`docs/site` / `:5190`).

## Run

```bash
pnpm --dir examples/apps/last-ts-site install   # once
pnpm run example:apps-last-ts-site
# → http://100.67.32.32:5220/
```

## Shape

| Piece | Role |
|-------|------|
| `src/pages/**` | **RSC** file routes |
| `Page.static` / `Page.build` / `Page.layout` | stamps on default export |
| `Page.getConfig(Stamped)` | Waku `getConfig` until createPages reads stamps |
| `last-ts/vite` `fileRouter` | `paths.gen.ts` codegen |
| `Router/waku` + client `Nav` | soft-nav (layout island) |
| `View.Service` | client island on `/view` |

File routes = render SSOT. Catalog (`Site`) is typed urls only.
