---
"last-ts": minor
"hyperlink-ts": patch
---

Remove `last-ts` custom JSX runtime (`jsxImportSource`, `jsx-runtime` / `jsx-dev-runtime` / `Jsx` subpaths). Views use ordinary React JSX; `R` lives on Layers via `View.Service` + `View.mount`, not JSX element brands.
