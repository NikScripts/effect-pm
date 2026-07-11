"use client";

// The base building block: a custom resource via `Resource.Tag`. Define a contract
// (a reactive `value` ref + `increment`/`reset` mutations), implement it with the plain
// `Resource.layer` object form over a SubscriptionRef, and drive it from buttons. The
// live count reads off the ref's `changes` stream. Tailwind scoped to .pm-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Resource from "@pm/Resource";
import { RegistryProvider, useAtomValue, useAtomSet } from "@pm/ui/atom-react";

// Build the resource + its atoms. Wrapped so it runs exactly once (see the singleton
// below): the resource registry rejects a duplicate group id, and Waku re-imports this
// client module on a content hot-edit — without the guard that trips DuplicateGroupId.
const buildCounter = () => {
  // 1. the contract — `value` is a reactive ref (Subscribable: get + changes)
  class Counter extends Resource.Tag<Counter>()("docs/Counter", {
    value: Resource.ref(Schema.Number),
    increment: Resource.effectFn(Schema.Void, { payload: { by: Schema.Number } }),
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
  return {
    countAtom: runtime.atom(Stream.unwrap(Effect.map(Counter, (c) => c.value.changes))),
    increment: runtime.fn((by: number) => Effect.flatMap(Counter, (c) => c.increment({ by }))),
    reset: runtime.fn(() => Effect.flatMap(Counter, (c) => c.reset)),
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __docsCounter: ReturnType<typeof buildCounter> | undefined;
}
const { countAtom, increment, reset } = (globalThis.__docsCounter ??= buildCounter());

function Panel(): React.ReactElement {
  const r = useAtomValue(countAtom);
  const count = AsyncResult.isSuccess(r) ? r.value : 0;
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
