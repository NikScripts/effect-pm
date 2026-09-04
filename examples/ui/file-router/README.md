# File-router prototype

Hyperlink-owned file router path table (not Waku `fs-router`). Walks
`fixtures/pages`, emits typed `paths.gen.ts`, feeds `Route.fileRoot`.

## Demo

```bash
pnpm run example:ui-file-router-codegen
```

Guide: [`docs/guides/file-router.md`](../../../docs/guides/file-router.md)  
Type lock: `test/ui-file-router-proto.test-d.ts`

## Regenerate

```bash
hyp file-router emit \
  --pages examples/ui/file-router/fixtures/pages \
  --out examples/ui/file-router/paths.gen.ts

# or the legacy one-shot script:
node examples/ui/file-router/scripts/gen-paths.mjs
```

`paths.gen.ts` is **committed** so clone/typecheck works without Vite.

## Vite plugin

```ts
import { fileRouter } from "hyperlink-ts/vite"

plugins: [
  fileRouter({
    pagesDir: "src/pages",
    outFile: "src/paths.gen.ts",
  }),
]
```

Opt-in — not wired into the docs site yet. See the guide for the DX contract
(committed gen + watch + `hyp file-router check`).

## Package APIs (Eng’d)

```ts
import * as Route from "hyperlink-ts/ui/Route"
import * as Router from "hyperlink-ts/ui/Router"
import { fileEntries } from "./paths.gen"

Route.make("app").add(Route.fileRoot(fileEntries))
Router.fileSystem(fileEntries)
```

Page marks: `hyperlink-ts/ui/Page` (`static` / `dynamic` / `build` / `layout`).
`Page.Service` + `createPages` adapter still open.
