# last-ts

**Last.ts** — Effect + React building blocks for typed routes, pages, Atom↔React, and codegen.

This package is the codesplit home for surfaces that are **not** Hyperlink-specific.
Hyperlink dashboard size chrome lives on `hyperlink-ts` as `Ui` (see
`docs/plans/last-ts-codesplit.md`).

## Imports

```ts
import * as Page from "last-ts/Page"
import * as AtomReact from "last-ts/AtomReact"
import { fileRouter } from "last-ts/vite"
```

Root barrels real modules only (`export * as Page`, `export * as AtomReact`). A `Last`
namespace ships only when it has a real cross-cutting API.
