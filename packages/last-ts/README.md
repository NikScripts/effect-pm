# last-ts

**Last.ts** — Effect + React building blocks for View DI, typed routes, pages,
Atom↔React, file-router codegen, and docgen.

This package is the codesplit home for surfaces that are **not** Hyperlink-specific.
Group Target helpers, dashboard compose (`Ui`), and family views stay on
`hyperlink-ts` (see `docs/plans/last-ts-codesplit.md`).

## Imports

```ts
import * as View from "last-ts/View"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import * as Page from "last-ts/Page"
import * as AtomReact from "last-ts/AtomReact"
import { fileRouter } from "last-ts/vite"
import * as Extractor from "last-ts/docgen/Extractor"
```

Root barrels real modules only. A `Last` namespace ships only when it has a real
cross-cutting API.
