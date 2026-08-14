/**
 * Child writes Title (SubscriptionRef) → parent heading live-updates.
 *
 * Run: `pnpm example:apps-title-live` → http://localhost:5210
 */
import * as React from "react";
import { Context, Effect, Layer, SubscriptionRef } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as AtomReact from "last-ts/AtomReact";
import * as Last from "last-ts/Last";

class Title extends Context.Service<
  Title,
  SubscriptionRef.SubscriptionRef<string>
>()("examples/title-live/Title") {}

const titleLayer = Layer.effect(Title, SubscriptionRef.make("Untitled"));

const Child = (props: {
  readonly title: SubscriptionRef.SubscriptionRef<string>;
}): React.ReactElement => (
  <div className="row">
    <button
      type="button"
      onClick={() =>
        Effect.runFork(SubscriptionRef.set(props.title, "From child"))
      }
    >
      Set “From child”
    </button>
    <button
      type="button"
      onClick={() =>
        Effect.runFork(
          SubscriptionRef.set(props.title, `Tick ${Date.now() % 100000}`),
        )
      }
    >
      Set timestamp
    </button>
    <button
      type="button"
      onClick={() =>
        Effect.runFork(SubscriptionRef.set(props.title, "Untitled"))
      }
    >
      Reset
    </button>
  </div>
);

const ParentReady = (props: {
  readonly title: SubscriptionRef.SubscriptionRef<string>;
}): React.ReactElement => {
  const titleAtom = React.useMemo(
    () => Atom.subscriptionRef(props.title),
    [props.title],
  );
  const value = AtomReact.useAtomValue(titleAtom);

  return (
    <div className="panel">
      <p className="eyebrow">parent</p>
      <h1>{value}</h1>
      <p className="muted">child buttons write the shared SubscriptionRef</p>
      <p className="eyebrow">child</p>
      <Child title={props.title} />
    </div>
  );
};

const Parent = (): React.ReactElement => {
  const runtime = AtomReact.useRuntime();
  const titleResult = AtomReact.useAtomValue(
    React.useMemo(() => runtime.atom(Title), [runtime]),
  );

  if (!AsyncResult.isSuccess(titleResult)) {
    return <p className="muted">loading title…</p>;
  }

  return <ParentReady title={titleResult.value} />;
};

/** Layer (+ registry/runtime) baked — children only. */
const Provider = Last.provider(titleLayer);

export const App = (): React.ReactElement => (
  <Provider>
    <main className="page">
      <header>
        <h2>Title live update</h2>
        <p>SubscriptionRef in Context — child set → parent re-render</p>
      </header>
      <Parent />
    </main>
  </Provider>
);
