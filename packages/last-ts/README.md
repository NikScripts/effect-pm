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
import * as Page from "last-ts/Page"
import * as Last from "last-ts/Last"
import * as Waku from "last-ts/Waku"
import * as Document from "last-ts/Document"
import { defineConfig } from "last-ts/config"  // never import waku in apps
import { fileRouter } from "last-ts/vite"

yield* Page.document(Document.title("Chapter"))

// Page edge
const App = Last.provide(Hello, Hello.layer)
export const provider = Last.provider(Waku.fromApi(Site))
```

**Host boundary:** apps import **only** `last-ts/*`. Optional `waku` peer stays
inside this package (`config` / `Waku`). Host RSC registration (`createPages`)
is Waku host wiring — not a last-ts product export.
**Document fields:** `docs/handoffs/page-document-lock.md`.
**Corrections:** `docs/handoffs/last-ts-api-corrections.md`.

Root barrels real modules only.
