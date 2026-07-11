{#build-and-browser-safety title="Build & browser safety" order=130 appliesTo=src}
# Build & browser safety

A tag is a light value a browser can import; the engine behind it is node-only. The package only
stays browser-safe if those two never share a module — everything here protects that line.

{#contract-not-impl-module .must appliesTo=src}
## Contract and implementation live in separate modules

A module that defines a tag must **not** also import that tag's layer, server, or storage — doing so
node-couples the tag, so importing the light contract drags the whole engine into a browser bundle.
Keep the tag alone; put the runtime next door.

``` ts
// ❌ bad — mail.ts defines the tag AND builds its layer → importing Mail pulls in the engine + sqlite
export class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", Job) {}
export const mailLayer = QueueResource.layer(Mail, { effect: handleJob })

// ✅ good — the tag stands alone; the runtime is a separate module
// mail.ts        →  export class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", Job) {}
// mail-server.ts →  import { Mail } from "./mail"
//                   export const mailLayer = QueueResource.layer(Mail, { effect: handleJob })
```

{#browser-imports-only-the-tag .must appliesTo=src}
## Browser code imports only the tag, from its subpath

A widget or browser bundle imports the tag from its own subpath (proven engine-free) — never the
node-only modules (`/storage/sqlite`, `/storage/redis`, the HTTP server layers), and prefer the
specific subpath over the root barrel.

``` ts
// ✅ good — the light tag, engine-free
import * as QueueResource from "@nikscripts/effect-pm/QueueResource"

// ❌ bad — a node-only module in browser code (pulls better-sqlite3, node:*)
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite"
```

{#esm-only-side-effect-free .must appliesTo=src}
## The package is ESM-only and side-effect-free

`"type": "module"`, `"sideEffects": false`, every optional peer (react, recharts, ink, sqlite, redis)
externalized — so a bundler can tree-shake unused engine code out of a browser build.

``` jsonc
// package.json
{
  "type": "module",
  "sideEffects": false
}
```

{#export-each-symbol-once .must appliesTo=src}
## Export each symbol exactly once

A symbol exported from two places (a re-export *and* a local `export const` of the same name) sends
the type-checker into a multi-minute loop. One export site per symbol.

``` ts
// ❌ bad — makeQueue exported twice
export { makeQueue } from "./internal/queue"
export const makeQueue = /* … */

// ✅ good — one home for the export
export { makeQueue } from "./internal/queue"
```
