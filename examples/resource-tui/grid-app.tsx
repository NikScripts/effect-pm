/**
 * @module examples/resource-tui/grid-app
 *
 * A full-screen terminal dashboard: a grid of resource "widgets" + a bottom
 * status bar. Each widget is an instance of one `Resource.tagFor` family (a
 * counter), rendered via the same `makeResourceAtoms` + `atom-react` the web
 * widget uses. Arrow keys / hjkl move the selection; i / d / r act on it.
 *
 * Just a playground for the layout — full screen, flex-wrap grid, sticky bar.
 */

import { Box, Text, useApp, useInput, useStdout } from "ink";
import * as React from "react";
import { Effect, Layer, Schema } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { Resource } from "../../src/Resource";
import { makeResourceAtoms } from "../resource-atoms/resource-atoms";
import {
  RegistryProvider,
  useAtomSet,
  useAtomValue,
} from "../queue-widget/atom-react";

// One counter contract; many instances (a family).
const Counter = Resource.tagFor("grid-counter", {
  value: Resource.query(Schema.Number),
  inc: Resource.mutate(Schema.Void),
  dec: Resource.mutate(Schema.Void),
  reset: Resource.mutate(Schema.Void).annotate({ destructive: true }),
});

class Alpha extends Counter<Alpha>("alpha") {}
class Bravo extends Counter<Bravo>("bravo") {}
class Charlie extends Counter<Charlie>("charlie") {}
class Delta extends Counter<Delta>("delta") {}
class Echo extends Counter<Echo>("echo") {}
class Foxtrot extends Counter<Foxtrot>("foxtrot") {}

const impl = (start: number) => {
  let v = start;
  return {
    value: Effect.sync(() => v),
    inc: Effect.sync(() => {
      v += 1;
    }),
    dec: Effect.sync(() => {
      v -= 1;
    }),
    reset: Effect.sync(() => {
      v = start;
    }),
  };
};

const runtime = Atom.runtime(
  Layer.mergeAll(
    Resource.layer(Alpha, impl(0)),
    Resource.layer(Bravo, impl(3)),
    Resource.layer(Charlie, impl(7)),
    Resource.layer(Delta, impl(1)),
    Resource.layer(Echo, impl(42)),
    Resource.layer(Foxtrot, impl(-5)),
  ),
);

const WIDGETS = [
  { name: "alpha", color: "cyan", atoms: makeResourceAtoms(runtime, Alpha) },
  { name: "bravo", color: "magenta", atoms: makeResourceAtoms(runtime, Bravo) },
  { name: "charlie", color: "yellow", atoms: makeResourceAtoms(runtime, Charlie) },
  { name: "delta", color: "green", atoms: makeResourceAtoms(runtime, Delta) },
  { name: "echo", color: "blue", atoms: makeResourceAtoms(runtime, Echo) },
  { name: "foxtrot", color: "red", atoms: makeResourceAtoms(runtime, Foxtrot) },
] as const;

const CELL_WIDTH = 22;

const Widget = (props: {
  readonly name: string;
  readonly color: string;
  readonly atoms: (typeof WIDGETS)[number]["atoms"];
  readonly selected: boolean;
}): React.ReactElement => {
  const result = useAtomValue(props.atoms.value);
  const value = AsyncResult.isSuccess(result) ? result.value : 0;
  return (
    <Box
      flexDirection="column"
      borderStyle={props.selected ? "double" : "round"}
      borderColor={props.selected ? "green" : "gray"}
      width={CELL_WIDTH}
      height={5}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
    >
      <Text bold color={props.color}>
        {props.name}
      </Text>
      <Text>
        value <Text bold>{value}</Text>
      </Text>
      <Text dimColor>{props.selected ? "● selected" : " "}</Text>
    </Box>
  );
};

const Grid = (): React.ReactElement => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;
  const perRow = Math.max(1, Math.floor((cols - 2) / (CELL_WIDTH + 1)));

  const [sel, setSel] = React.useState(0);
  const [clock, setClock] = React.useState(() =>
    new Date().toLocaleTimeString(),
  );
  React.useEffect(() => {
    const id = setInterval(
      () => setClock(new Date().toLocaleTimeString()),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const incs = WIDGETS.map((w) => useAtomSet(w.atoms.inc));
  const decs = WIDGETS.map((w) => useAtomSet(w.atoms.dec));
  const resets = WIDGETS.map((w) => useAtomSet(w.atoms.reset));

  useInput((input, key) => {
    if (key.leftArrow || input === "h") {
      setSel((s) => Math.max(0, s - 1));
    } else if (key.rightArrow || input === "l") {
      setSel((s) => Math.min(WIDGETS.length - 1, s + 1));
    } else if (key.upArrow || input === "k") {
      setSel((s) => Math.max(0, s - perRow));
    } else if (key.downArrow || input === "j") {
      setSel((s) => Math.min(WIDGETS.length - 1, s + perRow));
    } else if (input === "i") {
      incs[sel]?.(undefined);
    } else if (input === "d") {
      decs[sel]?.(undefined);
    } else if (input === "r") {
      resets[sel]?.(undefined);
    } else if (input === "q") {
      exit();
    }
  });

  const selected = WIDGETS[sel] ?? WIDGETS[0];
  const selResult = useAtomValue(selected.atoms.value);
  const selValue = AsyncResult.isSuccess(selResult) ? selResult.value : 0;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box paddingX={1}>
        <Text bold color="black" backgroundColor="cyan">
          {" ⬢ resource grid "}
        </Text>
        <Text dimColor> {WIDGETS.length} widgets</Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
        {WIDGETS.map((w, i) => (
          <Widget key={w.name} {...w} selected={i === sel} />
        ))}
      </Box>

      <Box paddingX={1} backgroundColor="gray">
        <Text color="greenBright" bold>
          ▸ {selected.name}
        </Text>
        <Text color="white"> = {selValue}</Text>
        <Text dimColor>
          {"    [↑↓←→/hjkl] move   [i] +1  [d] -1  [r] reset   [q] quit   "}
          {clock}
        </Text>
      </Box>
    </Box>
  );
};

export const App = (): React.ReactElement => (
  <RegistryProvider>
    <Grid />
  </RegistryProvider>
);
