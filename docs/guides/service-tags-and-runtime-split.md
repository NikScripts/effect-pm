# Service tags vs runtime layers (bundler‑safe split)

When you expose **`ProcessGroup.Service`**, **`Process.Service`**, or **`QueueResource.Service`** declarations to:

- **Browser bundles** (Vite, Next client components, RN Metro), **or**
- **Shared npm packages** that compile against both Edge and Node,

…it is **standard practice** to keep **two modules**:

| Module role | Imports | Exported to |
| --- | --- | --- |
| **Tags only** (`*.tags.ts`) | Dedicated subpaths (`@nikscripts/effect-pm/Process`, `/ProcessGroup`, `/QueueResource`, etc.) plus `effect`; **avoid** root barrel imports, `@effect/platform-node`, `better-sqlite3`, adapters, SQLite/Prisma **runtime**, custom server-only deps | Frontend, widgets, CLI type-only consumers, codegen |
| **Runtime** (`*.runtime.ts` / `main.ts`) | Tags module + **`Layer.mergeAll`** + **`ControlService.layerHttp`** + storage + whatever your process needs | Node (or Bun) OS edge only |

**Why:** Declaring services **instantiates merged `layer` factories** when you assemble the group. That is harmless in Node but **fatal** if a single file pulls **tags + `Layer.mergeAll` + `layerProcessStore` + SQLite** into a bundle that webpack/Vite analyzes for the client. Splitting avoids accidental resolution of native or platform-only subgraphs while still giving the UI **`typeof MyQueue`**, **`MyQueue.id`**, and **`MyGroup.contract`**.

## Tags module (minimal)

```typescript
// app/groups/production.tags.ts — safe to import from React/Vite
import { Effect } from "effect";
import { Process } from "@nikscripts/effect-pm/Process";
import { ProcessGroup } from "@nikscripts/effect-pm/ProcessGroup";
import { QueueResource } from "@nikscripts/effect-pm/QueueResource";

export class EmailQueue extends QueueResource.Service<EmailQueue, { to: string }, never>()(
  "@app/EmailQueue",
  { effect: () => Effect.void, concurrency: 1 },
) {}

export class Notify extends Process.Service<Notify>()("@app/Notify", {
  effect: Effect.void,
}) {}

export class ProdGroup extends ProcessGroup.Service<ProdGroup>()("@app/ProdGroup", [
  Notify,
  EmailQueue,
] as const) {}
```

- No root **`@nikscripts/effect-pm`** barrel import, **`ControlService`**, **`ProcessStorage.layer`**, **SQLite**, **`Endpoint.local(import.meta.url)`** child launcher wiring, secrets, etc.
- Effect `Effect` in queue/process config is acceptable as long as the module stays free of native-only transitive imports **you add** beside `effect-pm`.

## Runtime module (Node edge)

```typescript
// app/groups/production.runtime.ts — Node/Bun only
import { Layer } from "effect";
import { ControlService } from "@nikscripts/effect-pm/ControlService";
import { EmailQueue, Notify, ProdGroup } from "./production.tags";

export const prodEdgeLayer = Layer.mergeAll(
  ProdGroup.layer.pipe(Layer.provide(Layer.mergeAll(Notify.layer, EmailQueue.layer))),
  EmailQueue.layer,
  ControlService.layerHttp(ProdGroup, { port: 3001 }),
);
```

**Rule of thumb:** if a file **`pipe(Layer.provide`** or **`ControlService`** or **`SQLiteRuntimeStorage`**, it belongs in **runtime**, not beside your widget imports.

## For React / embeddable components

Consumers should import **tags** for:

- **Props** keyed by `typeof Notify`, `typeof EmailQueue`, `typeof ProdGroup`,
- **`encodeURIComponent(SomeTag.id)`** for **`ControlService`** REST paths,
- **`ProdGroup.contract`** for static layout while **`GET /contract`** refreshes live truth.

Widgets never need the **`Layer`** graph at compile-time if they receive a **`controlBaseUrl`** aimed at your **control gateway** — the server that forwards to private **`ControlService`** (see [dashboard-integration.md](./dashboard-integration.md)).

## Naming

Prefer explicit suffixes **`*.tags.ts`** / **`*.runtime.ts`** (or **`declarations`** / **`server`**) — anything that discourages **`import ../../../groups`** that accidentally grabs both.

## Related

- [dashboard-integration.md](./dashboard-integration.md) — product shape (React widgets + demo), **`peerDependencies`**, and **browser vs backend** topology for **`ControlService`**.
