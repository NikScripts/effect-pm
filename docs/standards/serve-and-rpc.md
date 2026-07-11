{#serve-and-rpc title="Serve, location & RPC" order=90 appliesTo=src}
# Serve, location & RPC

A resource is driven the same way whether it runs in-process or across the network. This chapter is
the vocabulary and the wiring rules that keep that true.

{#same-code-local-or-remote .must appliesTo=src}
## The same code runs local or remote

A resource is driven by the same `yield* Tag` whether it is in-process or served over RPC — only the
layer you provide differs. Never branch on local-vs-remote in a consumer. A field either behaves
identically in both, or its divergence surfaces as a type or dependency error — never a silent
same-looking-but-different (see *Principles → Fail loudly*).

{#serve-vocabulary .must appliesTo=src}
## Use the locked serve vocabulary

Four verbs, one axis — how a resource is made available:

- **`layer`** — local only.
- **`serve`** — local **and** served over RPC (the default for a node).
- **`serveRemote`** — served only, not runnable in-process.
- **`client`** — a remote handle to a served resource.

Transport is a **separate** line: `httpServer` / `httpClient` / `connect`. `Http` appears **only**
there — the core verbs stay transport-agnostic, so the same resource can be served over any protocol.

{#serve-through-spec-checked-forms .must appliesTo=src}
## Serve through the engine's spec-checked form, never a bare literal

Serve a resource through its engine form (`QueueResource.serve`, `Process.serve`) — these mount the
handlers **and** keep the worker or tick alive. `Resource.serve` only mounts handlers; using it for a
queue leaves the worker dead. Never hand-write a `{ tag, impl }` literal: it types as
`Record<string, unknown>` and silently swallows typos — the engine form spec-checks the impl against
the tag.

{#provide-merge-serve-layers .must appliesTo=src}
## `provideMerge` serve layers onto `httpServer`, never `provide`

`httpServer([...serveLayers])` unions each layer's requirement `R`, like `Layer.mergeAll`. Compose
with `Layer.provideMerge` so the serve layers stay in context; a bare `Layer.provide` prunes them,
because `httpServer`'s own type doesn't demand them.

``` ts
// ✅ good — serve layers preserved
const Node = Resource.httpServer([Counter.serve, Mail.serve])

// ❌ bad — provide prunes the serve layers off the server
program.pipe(Layer.provide(Counter.serve))
```

{#declare-dont-provide-in-workers .must appliesTo=src}
## Declare dependencies in the worker; provide at the serve boundary

A worker or tick body **declares** its dependencies with `yield* Tag` — it never `Effect.provide`s
them inline. Provide them once, at the serve/layer boundary, so `strictEffectProvide` stays clean and
the same body works local or served.

{#one-instance-one-materialization .must appliesTo=src}
## One instance, one materialization

A resource is a single instance. Its local use and its served handlers share **one** materialization
— serving must not re-run the impl generator. Compose extra behaviour as post-construction
combinators (`withReadiness`, `distributed`) piped onto the resource, not as re-materializations or
baked constructor options (see *Principles → Don't fight the framework*).
