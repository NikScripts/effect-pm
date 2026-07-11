"use client";

// The base building block: a custom resource via `Resource.Tag`. Define a contract
// (current / changes / increment / reset), implement it with `Resource.layer` over a
// SubscriptionRef, and drive it from buttons. Live count reads off the `changes` stream.
// Verified in Node before building this UI. Tailwind scoped to .pm-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import * as Resource from "@pm/Resource";
import { RegistryProvider, useAtomValue, useAtomSet } from "@pm/ui/atom-react";

// 1. the contract — `value` is a reactive ref (Subscribable: get + changes)
class Counter extends Resource.Tag<Counter>()("docs/Counter", {
  value: Resource.ref(Schema.Number),
  increment: Resource.effectFn(Schema.Void, { payload: { by: Schema.Number } }),
  reset: Resource.effectFn(Schema.Void),
}) {}

// 2. the local implementation — a SubscriptionRef, surfaced as the ref via `subscribable`
const counterLayer = Resource.layer(
  Counter,
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(0);
    return {
      value: Resource.subscribable(ref),
      increment: ({ by }: { readonly by: number }) => SubscriptionRef.update(ref, (n) => n + by),
      reset: SubscriptionRef.set(ref, 0),
    };
  }) as never,
);

// 3. reactive wiring — live count off the ref's `changes`, controls off the handle
const runtime = Atom.runtime(counterLayer);
const countAtom = runtime.atom(Stream.unwrap(Effect.map(Counter, (c) => c.value.changes)));
const increment = runtime.fn((by: number) => Effect.flatMap(Counter, (c) => c.increment({ by })));
const reset = runtime.fn(() => Effect.flatMap(Counter, (c) => c.reset));

function Panel(): React.ReactElement {
  const r = useAtomValue(countAtom);
  const count = AsyncResult.isSuccess(r) ? (r.value as number) : 0;
  const inc = useAtomSet(increment);
  const doReset = useAtomSet(reset);
  const [by, setBy] = React.useState(1);

  return (
    <div className="pm-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">docs/Counter</span>
        <span className="text-xs text-muted-foreground">Resource.Tag · in your browser</span>
      </div>
      <div className="text-3xl font-semibold tabular-nums text-foreground">{count}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">by</label>
        <input
          type="number"
          value={by}
          onChange={(e) => setBy(Number(e.target.value))}
          className="bg-card border rounded-md px-2 py-1 text-xs w-16"
        />
        <button type="button" onClick={() => inc(by)} className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground">
          Increment
        </button>
        <button type="button" onClick={() => doReset(undefined)} className="rounded-md px-2.5 py-1 text-xs font-medium bg-secondary text-secondary-foreground">
          Reset
        </button>
      </div>
    </div>
  );
}

export function CounterIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <Panel />
    </RegistryProvider>
  );
}
