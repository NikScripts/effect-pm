// The `docs/DemoQueue` HyperService — declared here in a plain (non-"use client") module so a
// content hot-edit that re-imports the QueueIsland entry doesn't re-declare it (the registry
// rejects a duplicate group id). Declared once; the island imports these prebuilt atoms.

import { Effect, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as WorkPool from "hyperlink-ts/WorkPool";

class DemoQueue extends WorkPool.define<DemoQueue, string, never>()("docs/DemoQueue", {
  concurrency: 1,
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing "${item}"`);
      yield* Effect.sleep("1000 millis");
    }),
}) {}

const runtime = Atom.runtime(DemoQueue.layer);

// live stats: subscribe to the queue's `status.changes` stream (per-priority sizes, in-flight, …).
export const statusAtom = runtime.atom(Stream.unwrap(Effect.map(DemoQueue, (q) => q.status.changes)));

// controls: each is a handle method run through the runtime.
export const enqueue = runtime.fn((p: { readonly text: string; readonly priority: "normal" | "high" | "low" }) =>
  Effect.flatMap(DemoQueue, (q) =>
    p.priority === "high" ? q.prioritize(p.text) : p.priority === "low" ? q.defer(p.text) : q.add(p.text),
  ),
);
export const pause = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.pause));
export const resume = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.resume));
export const clear = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.clear));
