# Resource toolkit — consumer guide (CLI / dashboard / TUI)

Self-contained reference for building tools on the Resource toolkit (`src/Resource.ts`,
branch `rewrite/resource-toolkit`). A "resource" is a schema-defined service tag; the same
`yield* Tag` code runs locally or against a remote server — **only the provided layer
changes**. This is the seam every tool uses to point a tag at in-process state or a running
server.

## Defining a resource (reference — tool authors mostly *consume*)

```ts
import { Schema } from "effect";
import { Resource } from "@nikscripts/effect-pm/Resource"; // (path TBD; today: src/Resource)

// Single resource — its id is also its wire prefix.
class Counter extends Resource.Tag<Counter>("@app/Counter", {
  description: "A counter.",            // resource-level help (optional)
})({
  current: Resource.query(Schema.Number).annotate({ description: "Current value." }),
  add: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } })
    .annotate({ description: "Add to the counter." }),
  reset: Resource.mutate(Schema.Void).annotate({ destructive: true }),
}) {}

// Family — many instances sharing one contract; groupId ("queue") is the wire prefix.
const Queue = Resource.tagFor("queue", spec, { description: "A queue." });
class Jobs extends Queue<Jobs>("@app/Jobs") {}
class Mail extends Queue<Mail>("@app/Mail") {}
```

- `Resource.query(success, opts?)` — idempotent read. `opts = { payload?, error? }`.
- `Resource.mutate(success, opts?)` — mutation (use `Schema.Void` when it returns nothing).
- `.annotate({ description?, destructive? })` — tool metadata, Effect annotation idiom.

## Consuming a resource

`yield* Tag` yields the service inferred from the spec:

- a method **without payload** → an `Effect<Success, Error>` **property** (`yield* c.current`);
- a method **with payload** → a **function** `(payload) => Effect<Success, Error>` (`yield* c.add({ by: 1 })`);
- the error channel is exactly what the method declared (`Schema.Never` → `never`). No `any`.

```ts
const program = Effect.gen(function* () {
  const c = yield* Counter;
  yield* c.add({ by: 1 });
  return yield* c.current;
});
```

## The local ↔ remote seam (the important part for tools)

Provide **one** of these layers for a tag; the `program` above is identical either way:

```ts
Resource.layer(Counter, impl)   // in-process: a real implementation
Resource.client(Counter)        // remote: forwards over RPC, needs an ambient Protocol
```

So a dashboard widget / CLI command is written once against the tag and switched between
in-process and a running server purely by which layer is provided. (Serving side:
`Resource.server(tag, impl)` for one, `Resource.serverFamily(factory, ...Resource.instance(tag, impl))`
for a family — one `RpcServer` hosts many resource types; wire tags are `groupId/method` so
they never collide.)

## Reading the contract for UI (metadata)

Everything a tool needs to render a resource is derivable from the tag:

```ts
import { methodMeta, specOf } from "@nikscripts/effect-pm/Resource";
import type { ResourceTag, Spec } from "@nikscripts/effect-pm/Resource";

function describe<Self, S extends Spec>(tag: ResourceTag<Self, S>) {
  for (const [name, method] of Object.entries(specOf(tag))) {
    const { kind, description, destructive } = methodMeta(method);
    // kind: "query" | "mutate"   → query prints / read-Atom; mutate confirms / runtime.fn
    // destructive: boolean       → CLI --yes gate, TUI warning, dashboard danger styling
    // description: string | undefined → help text / tooltip
  }
}
```

- `tag.id` — instance identity. `tag.groupId` — wire prefix. `tag.description` — resource help.
- `specOf(tag)` — the spec (method name → `Method`). `methodMeta(method)` → `{ kind, description, destructive }`.
- `groupOf(tag)` — the RPC group (for wiring a client/server).
- `ResourceTag<Self, S>` — the exported type to annotate a tag parameter.

A method's success/payload/error **schemas** are on the `Method` (`method.success`,
`method.payload`, `method.error`) — use them to render input forms and format output. Today
they're plain schemas; richer UX hints (optional/default → flags, literal unions → choices,
`Redacted` → masked, branded `Duration`/`DateTime` → pretty) are **not yet** standardized
(see "Not ready").

## READY to build on now

- Defining resources (`Tag` / `tagFor`) with `query` / `mutate` / `.annotate`.
- Consuming via `yield* Tag` → typed `ServiceOf` (honest `R` and error channels).
- **In-process** wiring: `Resource.layer(tag, impl)`.
- Metadata for rendering: `methodMeta`, `specOf`, `groupOf`, `tag.id/groupId/description`,
  `ResourceTag<Self, S>`.
- Stable identities: duplicate resource ids **and** group ids fail fast at declaration.
- The contract shape (`query` vs `mutate`, `destructive`, `description`) is **locked** —
  build CLI/dashboard rendering against it.

## NOT ready (do not build remote/live paths against these yet)

- **Live updates (`changes: Stream<Snapshot>`).** The push primitive that powers dashboard
  atoms / CLI `--watch` / TUI is **designed but not built** (`resource-changes-stream.md`),
  and there's an open streaming blocker. Build read-once (`Effect`) UI now; design `--watch`
  / live panels behind a seam you can fill in when `changes` lands.
- **Cheap remote connection.** `Resource.client(tag)` works but needs an ambient RPC
  `Protocol`; the one-liner `Resource.connect({ url, headers })` helper does **not** exist
  yet (lands with `Resource.Host`). Until then, wiring a real transport is manual. **Prefer
  building against `Resource.layer` (in-process)**; keep the client swap as a layer boundary.
- **Schema-as-UX hints.** No shared reader yet (flags/choices/masking/pretty-print). Render
  from raw schemas for now; don't hard-code formatting you'll want to derive later.
- **Queue data-plane.** `queueControlSpec` (control/observation: size/pause/clear/…) works;
  item verbs (`add`/`release`/…) are **not** ported yet (need per-queue itemSchema encoding).
- **Package paths.** Final public import subpaths aren't fixed; import from `src/Resource`
  within the repo for now.

## One-line rule

Build the **logic and rendering** against the tag + `ServiceOf` + `methodMeta` now (all
stable). Keep **"live" and "remote transport"** behind seams — they're coming but not wired.
