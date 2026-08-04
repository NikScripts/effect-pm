// The `docs/Double` Gate — declared here in a plain (non-"use client") module so a
// content hot-edit that re-imports the GateIsland entry doesn't re-declare it (the
// registry rejects a duplicate group id). Declared once; the island imports these atoms.

import { Effect, Schema, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Gate from "hyperlink-ts/Gate";

class Double extends Gate.define<Double>()("docs/Double", {
  payload: Schema.Number,
  success: Schema.Number,
  concurrency: 2, // only 2 run at once; extra calls queue behind the gate
  effect: (n: number) =>
    Effect.gen(function* () {
      yield* Effect.sleep("900 millis"); // slow enough to watch in-flight
      return n * 2;
    }),
}) {}

const runtime = Atom.runtime(Double.layer);
// the fn atom's value is the AsyncResult of the last run
export const runFn = runtime.fn((n: number) => Effect.flatMap(Double, (d) => d.run(n)));
// live in-flight count off the Subscribable's `changes` stream (a Number ref)
export const inFlightAtom = runtime.atom(Stream.unwrap(Effect.map(Double, (d) => d.inFlight.changes)));
