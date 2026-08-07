# Last.ts site demo

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng — standalone demo app  
**Not Hyperlink docs** (`docs/site` / `:5190`). That is a different product.

## Demo

```bash
pnpm exec vite --config examples/apps/last-ts-site/vite.config.ts
# → http://100.67.32.32:5220/  (Tailscale)
```

Script: `example:apps-last-ts-site` (same vite config).

Shows **current** last-ts APIs only:

| Surface | What |
|---------|------|
| `Router.make` + `RouterBuilder` | HttpApi-shaped catalog + handlers |
| `Page.Request` / `Document` | Effect page handler on `/` |
| JSX handler overload | `/about` |
| `View.Service(key, default)` | `/view` slot + `provideService` override |
| Params | `/guides/:slug` |
| `History.layer` + `Last.provider` | soft-nav Link / Outlet |

## Fixes landed with the demo

- `Memory` / `History` must `Object.assign(service, { _handlers })` — object
  spread snapped live `pathname` getters so `go()` looked like a no-op.
- `Last.provider` builds the Layer once and reuses that Context for
  `Atom.runtime` + `Router.Provider`.
- `internal/fileRouter` imports `./route` + `./routes` (not `../Route`) to
  break the `routeFileSystem` TDZ cycle.
