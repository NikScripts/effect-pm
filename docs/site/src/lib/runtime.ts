// Effect runtimes for the docs app — the dual-runtime seam from the typeonce
// RSC pattern, translated to Effect v4.
//
// `runServer` executes server-side Effects (content + API-data pipelines) inside server components,
// providing the Node platform services they need. Data files are read through `effect/FileSystem`
// (the `NodeFileSystem` layer) — NEVER `node:fs`, per docs/standards effect-style. Effects that need
// no services still run fine (their `never` requirement is satisfied trivially).

import { Effect, Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";

// The services runServer provides (FileSystem, backed by Node) — derived from the layer so the
// requirement type is exactly what `provide` removes.
type ServerServices = Layer.Success<typeof NodeFileSystem.layer>;

export const runServer = <A, E>(
  effect: Effect.Effect<A, E, ServerServices>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));

// Future SSR/RSC hydration seam (no implementation now): the client island runtime
// would be `Atom.runtime(layer)` (see examples/queue-widget), and server->client
// handoff would use `effect/unstable/reactivity/Hydration` (`dehydrate`/`hydrate`)
// with atom-react's `HydrationBoundary`. Wired only when a doc page needs a live island.
