/**
 * @module examples/resource-tui/counter-app
 *
 * A resource rendered in the **terminal** — the third skin. It reuses the *exact*
 * `atom-react` hooks and `makeResourceAtoms` the web widget uses; only the
 * renderer differs (Ink's `<Box>`/`<Text>` instead of the DOM). Hooks live in
 * React core, not the renderer, so "one contract → N renderers" just works.
 *
 * Read-once today (the read atom refreshes on each command via reactivity keys);
 * swaps to a live `changes` stream when the toolkit ships it — one line.
 */

import { Box, Text, useApp, useInput } from "ink";
import * as React from "react";
import { Effect, Schema } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Resource from "../../src/Resource";
import { makeResourceAtoms } from "../resource-atoms/resource-atoms";
import {
  RegistryProvider,
  useAtomSet,
  useAtomValue,
} from "../../src/ui/atom-react";

class Counter extends Resource.Tag<Counter>("Counter")({
  current: Resource.query(Schema.Number),
  reset: Resource.mutate(Schema.Void).annotate({ destructive: true }),
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
}) {}

let value = 0;
const counterLayer = Resource.layer(Counter, {
  current: Effect.sync(() => value),
  reset: Effect.sync(() => {
    value = 0;
  }),
  increment: ({ by }) =>
    Effect.sync(() => {
      value += by;
    }),
});

const runtime = Atom.runtime(counterLayer);
const atoms = makeResourceAtoms(runtime, Counter);

const CounterPanel = (): React.ReactElement => {
  const { exit } = useApp();
  const result = useAtomValue(atoms.current);
  const current = AsyncResult.isSuccess(result) ? String(result.value) : "…";
  const increment = useAtomSet(atoms.increment);
  const reset = useAtomSet(atoms.reset);

  useInput((input) => {
    if (input === "i") {
      increment({ by: 1 });
    } else if (input === "d") {
      increment({ by: -1 });
    } else if (input === "r") {
      reset(undefined);
    } else if (input === "q") {
      exit();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Counter — resource TUI</Text>
      <Text>
        current: <Text color="green">{current}</Text>
      </Text>
      <Text dimColor>[i] +1 [d] -1 [r] reset [q] quit</Text>
    </Box>
  );
};

export const App = (): React.ReactElement => (
  <RegistryProvider>
    <CounterPanel />
  </RegistryProvider>
);
