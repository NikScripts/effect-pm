# last-ts

**Last.ts** — Effect + React building blocks for View DI, typed routes, pages,
Atom↔React, file-router codegen, and docgen.

This package is the codesplit home for surfaces that are **not** Hyperlink-specific.
Group Target helpers, dashboard compose (`Ui`), and family views stay on
`hyperlink-ts` (see `docs/plans/last-ts-codesplit.md`).

## Imports

```ts
import * as View from "last-ts/View"       // View.make — not View.Service
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import * as Page from "last-ts/Page"       // Request / Document; no asDefault / getConfig
import * as Last from "last-ts/Last"
import { fileRouter } from "last-ts/vite"  // path codegen — design pass still owed
```

**Corrections lock:** `docs/handoffs/last-ts-api-corrections.md` — never author
`getConfig` / `pageConfig` / `Page.asDefault` / deleted Route bake merges.

Root barrels real modules only.
