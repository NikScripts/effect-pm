/**
 * @module examples/resource-tui/grid-app
 *
 * A full-screen terminal dashboard: a grid of resource "widgets", a command bar,
 * and a status bar. Each widget is an instance of one `Resource.tagFor` family,
 * rendered via the same `makeResourceAtoms` + `atom-react` the web widget uses.
 *
 * - Keys: arrows / hjkl move selection; i / d / r act on it; `:` opens the command
 *   bar; q quits.
 * - Command bar (`:`): `inc [name] [n]`, `dec [name] [n]`, `reset [name]`,
 *   `sel <name>`, `q`. A name defaults to the selected widget.
 * - Mouse (EXPERIMENTAL): scroll moves the selection; click selects a widget by
 *   hit-testing the grid geometry. Ink has no native mouse support, so this enables
 *   terminal mouse tracking + parses stdin directly; tune GRID_TOP/GRID_LEFT/strides
 *   in your terminal if clicks land off.
 */

import { Box, Text, useApp, useInput, useStdin, useStdout } from "ink";
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
const X_STRIDE = CELL_WIDTH + 1; // + marginRight
const Y_STRIDE = 6; // cell height 5 + marginBottom 1
const GRID_TOP = 3; // header (1) + grid top padding (1), 1-based first cell row
const GRID_LEFT = 2; // grid left padding, 1-based first cell col

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
  const { stdin } = useStdin();
  const cols = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;
  const perRow = Math.max(1, Math.floor((cols - GRID_LEFT) / X_STRIDE));

  const [sel, setSel] = React.useState(0);
  const [mode, setMode] = React.useState<"normal" | "command">("normal");
  const [cmd, setCmd] = React.useState("");
  const [msg, setMsg] = React.useState("type : for a command");
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

  const indexOf = (name: string) =>
    WIDGETS.findIndex((w) => w.name === name);

  const run = (verb: string, name: string, count: number) => {
    const i = indexOf(name);
    if (i < 0) {
      setMsg(`no widget "${name}"`);
      return;
    }
    if (verb === "inc") {
      for (let k = 0; k < count; k++) incs[i]?.(undefined);
      setMsg(`inc ${name}${count > 1 ? ` ×${count}` : ""}`);
    } else if (verb === "dec") {
      for (let k = 0; k < count; k++) decs[i]?.(undefined);
      setMsg(`dec ${name}${count > 1 ? ` ×${count}` : ""}`);
    } else if (verb === "reset") {
      resets[i]?.(undefined);
      setMsg(`reset ${name}`);
    } else if (verb === "sel") {
      setSel(i);
      setMsg(`selected ${name}`);
    } else {
      setMsg(`unknown command "${verb}"`);
    }
  };

  const execute = (line: string) => {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    const verb = parts[0];
    if (verb === undefined) {
      return;
    }
    if (verb === "q" || verb === "quit") {
      exit();
      return;
    }
    let name: string = WIDGETS[sel]?.name ?? "alpha";
    let count = 1;
    for (const t of parts.slice(1)) {
      if (/^-?\d+$/.test(t)) {
        count = Math.abs(Number(t));
      } else {
        name = t;
      }
    }
    run(verb, name, count);
  };

  useInput((input, key) => {
    if (mode === "command") {
      if (key.return) {
        execute(cmd);
        setCmd("");
        setMode("normal");
      } else if (key.escape) {
        setCmd("");
        setMode("normal");
      } else if (key.backspace || key.delete) {
        setCmd((c) => c.slice(0, -1));
      } else if (input.length > 0 && !key.ctrl && !key.meta) {
        setCmd((c) => c + input);
      }
      return;
    }
    if (input === ":") {
      setMode("command");
      setCmd("");
    } else if (key.leftArrow || input === "h") {
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

  // ── EXPERIMENTAL mouse: enable SGR tracking, parse stdin directly ──
  React.useEffect(() => {
    // Only with the real terminal stdin — skips the test's fake stream (which would
    // otherwise capture the mouse-enable escape codes as output).
    if (stdin === undefined || stdin !== process.stdin || stdin.isTTY !== true) {
      return;
    }
    stdout?.write("[?1000h[?1006h"); // enable mouse + SGR extended
    const onData = (data: Buffer) => {
      const re = /\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m: RegExpExecArray | null;
      const text = data.toString("utf8");
      while ((m = re.exec(text)) !== null) {
        const button = Number(m[1]);
        const x = Number(m[2]);
        const y = Number(m[3]);
        const press = m[4] === "M";
        if (button === 64) {
          setSel((s) => Math.max(0, s - 1)); // scroll up
        } else if (button === 65) {
          setSel((s) => Math.min(WIDGETS.length - 1, s + 1)); // scroll down
        } else if (button === 0 && press) {
          const row = Math.floor((y - GRID_TOP) / Y_STRIDE);
          const col = Math.floor((x - GRID_LEFT) / X_STRIDE);
          if (row >= 0 && col >= 0 && col < perRow) {
            const idx = row * perRow + col;
            if (idx < WIDGETS.length) {
              setSel(idx);
            }
          }
        }
      }
    };
    stdin.on("data", onData);
    return () => {
      stdout?.write("[?1000l[?1006l");
      stdin.off("data", onData);
    };
  }, [stdin, stdout, perRow]);

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

      <Box flexDirection="column">
        <Box paddingX={1} backgroundColor="gray">
          <Text color="greenBright" bold>
            ▸ {selected.name}
          </Text>
          <Text color="white"> = {selValue}</Text>
          <Text dimColor>
            {"    [hjkl/arrows] move  [i/d/r] act  [:] command  [q] quit   "}
            {clock}
          </Text>
        </Box>
        <Box paddingX={1}>
          {mode === "command" ? (
            <Text color="yellowBright">
              :{cmd}
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text dimColor>{msg}</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export const App = (): React.ReactElement => (
  <RegistryProvider>
    <Grid />
  </RegistryProvider>
);
