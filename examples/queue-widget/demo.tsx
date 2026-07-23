/**
 * @module examples/queue-widget/demo
 *
 * A **real `WorkPool` running client-side** (no server, no RPC, no mock),
 * wired to the widget through Effect 4's native Atom layer. Everything the queue
 * service exposes — enqueue by priority, pause/resume, clear, live sizes — is
 * driven straight from the browser.
 *
 * `Atom.runtime(layer)` is the seam: today the local `DemoQueue.layer`; swap it
 * for an RPC-backed client layer (same tag) later and nothing else changes.
 */

import * as React from "react";
import { Effect } from "effect";
import { AsyncResult, Atom, Reactivity } from "effect/unstable/reactivity";
// Import the module directly (not the package barrel) so the browser bundle
// doesn't drag in Node-only manager code.
import * as WorkPool from "../../src/WorkPool";
import { QueueWidget, type QueueStatus } from "./QueueWidget";
import {
  RegistryProvider,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from "../../src/ui/atom-react";
import { makeQueueAtoms } from "./queue-atoms";

// Shared reactivity key: mutations and worker completions invalidate it, the
// `stats` read atom listens on it.
const QueueKey = ["queue-widget-demo"] as const;

// A real priority queue. concurrency 1 + a visible delay so you can watch items
// queue and drain. The worker invalidates QueueKey on each completion — a demo
// shim for live stats until the handle exposes `changes` (event-driven, no poll).
class DemoQueue extends WorkPool.Service<DemoQueue, string, never>()(
  "queue-widget-demo",
  {
    effect: (item: string) =>
      Effect.gen(function* () {
        yield* Effect.sleep("1200 millis");
        yield* Effect.logInfo(`processed: ${item}`);
        yield* Reactivity.invalidate(QueueKey);
      }),
    concurrency: 1,
    // Start paused so enqueued items visibly accumulate (size grows); press
    // Start to drain them. Otherwise the worker grabs each item immediately and
    // `pending` never climbs above 0.
    paused: true,
  },
) {}

const runtime = Atom.runtime(DemoQueue.layer);
const atoms = makeQueueAtoms(runtime, DemoQueue, QueueKey);

const enqueue = runtime.fn(
  (arg: { readonly text: string; readonly priority: "normal" | "high" | "low" }) =>
    Effect.flatMap(DemoQueue, (queue) => {
      const add =
        arg.priority === "high"
          ? queue.prioritize
          : arg.priority === "low"
            ? queue.defer
            : queue.add;
      return add(arg.text);
    }),
  { reactivityKeys: QueueKey },
);

const ConnectedWidget = (): React.ReactElement => {
  const result = useAtomValue(atoms.stats);
  const stats = AsyncResult.isSuccess(result) ? result.value : undefined;
  const clearResult = useAtomValue(atoms.clear);
  const releaseResult = useAtomValue(atoms.release);
  const dropResult = useAtomValue(atoms.drop);
  const deadLetterResult = useAtomValue(atoms.deadLetter);

  const add = useAtomSet(enqueue);
  const start = useAtomSet(atoms.start);
  const pause = useAtomSet(atoms.pause);
  const resume = useAtomSet(atoms.resume);
  const clear = useAtomSet(atoms.clear);
  const release = useAtomSet(atoms.release);
  const shutdown = useAtomSet(atoms.shutdown);
  const drop = useAtomSet(atoms.drop);
  const deadLetter = useAtomSet(atoms.deadLetter);
  const refresh = useAtomRefresh(atoms.stats);

  // No status read on the handle yet — track it from the controls (next iteration).
  const [status, setStatus] = React.useState<QueueStatus>("paused");

  // Show the most recent clear/release return value.
  const candidates: ReadonlyArray<{ readonly ts: number; readonly text: string }> = [
    ...(AsyncResult.isSuccess(clearResult)
      ? [{ ts: clearResult.timestamp, text: `cleared ${clearResult.value}` }]
      : []),
    ...(AsyncResult.isSuccess(releaseResult)
      ? [{ ts: releaseResult.timestamp, text: `released ${releaseResult.value.length}` }]
      : []),
    ...(AsyncResult.isSuccess(dropResult)
      ? [{ ts: dropResult.timestamp, text: `dropped ${dropResult.value.length}` }]
      : []),
    ...(AsyncResult.isSuccess(deadLetterResult)
      ? [
          {
            ts: deadLetterResult.timestamp,
            text: `dead-lettered ${deadLetterResult.value.length}`,
          },
        ]
      : []),
  ];
  const lastResult = [...candidates].sort((a, b) => b.ts - a.ts)[0]?.text;

  return (
    <main style={{ padding: 24, display: "grid", gap: 16, justifyItems: "start" }}>
      <h1>Queue widget — a real queue running on the client</h1>
      <QueueWidget
        title="queue-widget-demo"
        stats={stats}
        status={status}
        lastResult={lastResult}
        onEnqueue={(text, priority) => add({ text, priority })}
        onStart={() => start(undefined)}
        onResume={() => {
          resume(undefined);
          setStatus("running");
        }}
        onPause={() => {
          pause(undefined);
          setStatus("paused");
        }}
        onClear={() => clear(undefined)}
        onRelease={() => release(undefined)}
        onShutdown={() => {
          shutdown(undefined);
          setStatus("shutdown");
        }}
        onRefresh={refresh}
        onDrop={(item) => drop(item)}
        onDeadLetter={(item) => deadLetter(item)}
      />
    </main>
  );
};

export const App = (): React.ReactElement => (
  <RegistryProvider>
    <ConnectedWidget />
  </RegistryProvider>
);
