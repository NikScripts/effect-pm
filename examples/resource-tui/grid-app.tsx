/**
 * @module examples/resource-tui/grid-app
 *
 * A full-screen terminal dashboard: a scrollable grid of resource "widgets", a
 * command bar, and a status/shortcuts bar. Each widget is an instance of one
 * `Resource.tagFor` family, rendered via the same `makeResourceAtoms` +
 * `atom-react` the web widget uses.
 *
 * - Keys: arrows / hjkl move selection (auto-scrolls to keep it visible); i / d / r
 *   act on it; `:` opens the command bar; q quits.
 * - Command bar (`:`): `inc [name] [n]`, `dec [name] [n]`, `reset [name]`,
 *   `sel <name>`, `q`. A name defaults to the selected widget.
 * - Mouse (EXPERIMENTAL): wheel **pages** the grid; click selects a widget by
 *   hit-testing the (scrolled) grid geometry. Tune GRID_TOP/GRID_LEFT/strides if
 *   clicks land off.
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

const PALETTE = [
  "cyan",
  "magenta",
  "yellow",
  "green",
  "blue",
  "red",
  "cyanBright",
  "magentaBright",
];

// Enough instances to overflow the screen so paging is visible. Each is built
// from the family once (Counter(id)) and reused for its layer + atoms.
const SPECS = Array.from({ length: 24 }, (_, i) => {
  const name = `w${i + 1}`;
  return {
    name,
    color: PALETTE[i % PALETTE.length] ?? "white",
    tag: Counter(name),
    start: i * 3,
  };
});

const runtime = Atom.runtime(
  SPECS.map((s) => Resource.layer(s.tag, impl(s.start))).reduce((a, b) =>
    Layer.merge(a, b),
  ),
);

const WIDGETS = SPECS.map((s) => ({
  name: s.name,
  color: s.color,
  atoms: makeResourceAtoms(runtime, s.tag),
}));

const FIRST = WIDGETS[0];
if (FIRST === undefined) {
  throw new Error("grid: no widgets");
}

const CELL_WIDTH = 22;
const X_STRIDE = CELL_WIDTH + 1;
const Y_STRIDE = 6;
const GRID_TOP = 3; // header (1) + grid top padding (1), 1-based first cell row
const GRID_LEFT = 2;
const FOOTER_H = 4; // command bar (margin + line) + status line + slack

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
  const totalRows = Math.ceil(WIDGETS.length / perRow);
  const gridH = Math.max(Y_STRIDE, rows - 1 - FOOTER_H);
  const visibleRows = Math.max(1, Math.floor(gridH / Y_STRIDE));
  const maxScroll = Math.max(0, totalRows - visibleRows);

  const [sel, setSel] = React.useState(0);
  const [scrollRow, setScrollRow] = React.useState(0);
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

  const scroll = Math.min(scrollRow, maxScroll);

  // Keep the selection in view when navigating by keyboard.
  React.useEffect(() => {
    const selRow = Math.floor(sel / perRow);
    if (selRow < scroll) {
      setScrollRow(selRow);
    } else if (selRow >= scroll + visibleRows) {
      setScrollRow(selRow - visibleRows + 1);
    }
  }, [sel, perRow, visibleRows, scroll]);

  const incs = WIDGETS.map((w) => useAtomSet(w.atoms.inc));
  const decs = WIDGETS.map((w) => useAtomSet(w.atoms.dec));
  const resets = WIDGETS.map((w) => useAtomSet(w.atoms.reset));

  const indexOf = (name: string) => WIDGETS.findIndex((w) => w.name === name);

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
    let name: string = WIDGETS[sel]?.name ?? "w1";
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

  // Mouse handler reads live layout via a ref so enabling tracking stays a
  // one-time effect (no re-enabling on every scroll).
  const view = React.useRef({ scroll, perRow, visibleRows, maxScroll });
  view.current = { scroll, perRow, visibleRows, maxScroll };

  React.useEffect(() => {
    // Real terminal stdin only — skips the test's fake stream (which would
    // otherwise capture the mouse-enable escape codes as output).
    if (stdin === undefined || stdin !== process.stdin || stdin.isTTY !== true) {
      return;
    }
    stdout?.write("[?1000h[?1006h");
    const onData = (data: Buffer) => {
      const re = /\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m: RegExpExecArray | null;
      const text = data.toString("utf8");
      while ((m = re.exec(text)) !== null) {
        const button = Number(m[1]);
        const x = Number(m[2]);
        const y = Number(m[3]);
        const press = m[4] === "M";
        const v = view.current;
        if (button === 64) {
          setScrollRow((s) => Math.max(0, s - 1));
        } else if (button === 65) {
          setScrollRow((s) => Math.min(v.maxScroll, s + 1));
        } else if (button === 0 && press) {
          const row = Math.floor((y - GRID_TOP) / Y_STRIDE);
          const col = Math.floor((x - GRID_LEFT) / X_STRIDE);
          if (row >= 0 && row < v.visibleRows && col >= 0 && col < v.perRow) {
            const idx = (v.scroll + row) * v.perRow + col;
            if (idx < WIDGETS.length) {
              setSel(idx);
            }
          }
        }
      }
    };
    stdin.on("data", onData);
    return () => {
      stdout?.write("[?1000l[?1006l");
      stdin.off("data", onData);
    };
  }, [stdin, stdout]);

  const selected = WIDGETS[sel] ?? FIRST;
  const selResult = useAtomValue(selected.atoms.value);
  const selValue = AsyncResult.isSuccess(selResult) ? selResult.value : 0;

  const start = scroll * perRow;
  const visible = WIDGETS.slice(start, start + visibleRows * perRow);
  const more = maxScroll > 0;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box paddingX={1}>
        <Text bold color="black" backgroundColor="cyan">
          {" ⬢ resource grid "}
        </Text>
        <Text dimColor>
          {" "}
          {WIDGETS.length} widgets
          {more
            ? `  ·  rows ${scroll + 1}-${Math.min(scroll + visibleRows, totalRows)}/${totalRows} ${scroll < maxScroll ? "▼" : ""}${scroll > 0 ? "▲" : ""}`
            : ""}
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
        {visible.map((w, vi) => {
          const i = start + vi;
          return <Widget key={w.name} {...w} selected={i === sel} />;
        })}
      </Box>

      <Box flexDirection="column">
        {/* command bar — above the shortcuts, padded */}
        <Box paddingX={2} marginTop={1}>
          {mode === "command" ? (
            <Text color="yellowBright">
              :{cmd}
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text dimColor>{msg}</Text>
          )}
        </Box>
        <Box paddingX={1} backgroundColor="gray">
          <Text color="greenBright" bold>
            ▸ {selected.name}
          </Text>
          <Text color="white"> = {selValue}</Text>
          <Text dimColor>
            {
              "    [hjkl/arrows] move  [i/d/r] act  [:] command  [scroll] page  [q] quit   "
            }
            {clock}
          </Text>
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
