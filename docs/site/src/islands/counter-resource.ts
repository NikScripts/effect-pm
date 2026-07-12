// The `docs/Counter` resource — declared here, in a plain (non-"use client") module,
// so that when Waku re-imports the CounterIsland *entry* on a content hot-edit it does
// NOT re-declare the resource (the registry rejects a duplicate group id). The class is
// declared once; the island just imports these prebuilt atoms. This is the seam between
// "the resource" and "the UI that drives it" — the same split a real app would make.

import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Resource from "@pm/Resource";

// 1. the contract — `value` is a reactive ref (Subscribable: get + changes)
class Counter extends Resource.Tag<Counter>()("docs/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn({ by: Schema.Number }),
  reset: Resource.effectFn(Schema.Void),
}) {}

// 2. the local implementation — a SubscriptionRef surfaced as the ref via `subscribable`
const ref = Effect.runSync(SubscriptionRef.make(0));
const counterLayer = Resource.layer(Counter, {
  value: Resource.subscribable(ref),
  increment: ({ by }) => SubscriptionRef.update(ref, (n) => n + by),
  reset: SubscriptionRef.set(ref, 0),
});

// 3. reactive wiring — live count off the ref's `changes`, mutations off the handle
const runtime = Atom.runtime(counterLayer);
export const countAtom = runtime.atom(Stream.unwrap(Effect.map(Counter, (c) => c.value.changes)));
export const increment = runtime.fn((by: number) => Effect.flatMap(Counter, (c) => c.increment({ by })));
export const reset = runtime.fn(() => Effect.flatMap(Counter, (c) => c.reset));
