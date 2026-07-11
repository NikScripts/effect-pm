// Effect runtimes for the docs app — the dual-runtime seam from the typeonce
// RSC pattern, translated to Effect v4.
//
// `runServer` executes server-side Effects (content pipeline) inside server
// components. Today the pipeline needs no external services, so this is a thin
// `runPromise`; when it grows deps (e.g. an FS layer for a build-time export via
// `@effect/platform-node` `NodeFileSystem` — never `node:fs`), provide them by
// swapping this for a `ManagedRuntime`/layer here. Server components call `runServer`;
// nothing else changes.

import { Effect } from "effect";

export const runServer = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

// Future SSR/RSC hydration seam (no implementation now): the client island runtime
// would be `Atom.runtime(layer)` (see examples/queue-widget), and server->client
// handoff would use `effect/unstable/reactivity/Hydration` (`dehydrate`/`hydrate`)
// with atom-react's `HydrationBoundary`. Wired only when a doc page needs a live island.
