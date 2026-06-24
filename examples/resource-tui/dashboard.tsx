/**
 * @module examples/resource-tui/dashboard
 *
 * The navigable dashboard on **real queues** (`./live-queues`) — no mock. Each grid
 * card reads a queue's live `status`; opening one shows the shared XL widget driven
 * by live `status` + `metrics`, with the real `logs` stream as the tail.
 *
 *   ↑↓←→ / hjkl  move · Enter/Space open or drill · Esc/Backspace back/up
 *   mouse  wheel scrolls, click selects, click again opens
 *   :  command bar (type any part of a tag name) · Ctrl+E edit mode · Ctrl+C quit
 *
 *   pnpm run example:dashboard
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  REGISTRY,
  TREE,
  type Group,
  type Node,
  type QueueBundle,
} from "./live-queues";
import { RegistryProvider, useAtomSet, useAtomValue } from "../queue-widget/atom-react";
import {
  bar,
  BLANK_BORDER,
  COLOR,
  displayName,
  PageXL,
  PAGE_HEIGHT,
  STATUS_ICON,
  type Priority,
  type Status,
  type View,
} from "./queue-widget";

const QUEUES = Object.keys(REGISTRY);
const CELL_HEIGHT = 7;
const SYM: Record<Priority, { symbol: string; color: string }> = {
  high: { symbol: "▲", color: "red" },
  normal: { symbol: "•", color: "white" },
  low: { symbol: "▼", color: "blue" },
};
const LEVEL_COLOR: Record<string, string> = {
  Trace: "gray",
  Debug: "gray",
  Info: "white",
  Warning: "yellow",
  Error: "red",
  Fatal: "red",
};

const statusOf = (phase: string, paused: boolean): Status =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const useTerminalSize = (): { cols: number; rows: number } => {
  const { stdout } = useStdout();
  const [size, setSize] = React.useState({
    cols: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });
  React.useEffect(() => {
    if (stdout === undefined) {
      return;
    }
    const onResize = () => setSize({ cols: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
};

const PrioRow = (props: {
  readonly p: Priority;
  readonly count: number;
  readonly max: number;
  readonly barWidth: number;
  readonly showLabel: boolean;
}): React.ReactElement => {
  const s = SYM[props.p];
  return (
    <Box>
      <Box width={props.showLabel ? 7 : 2}>
        <Text>
          {s.symbol}
          {props.showLabel ? ` ${props.p}` : ""}
        </Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(props.count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={4} justifyContent="flex-end">
        <Text>{props.count}</Text>
      </Box>
    </Box>
  );
};

// a queue grid cell — reads its own live status
const QueueCell = (props: {
  readonly id: string;
  readonly bundle: QueueBundle;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { id, bundle, width, selected } = props;
  const r = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const status = statusOf(s?.phase ?? "running", s?.paused ?? false);
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  const wide = width >= 40;
  const barWidth = Math.max(4, width - 4 - (wide ? 7 : 2) - 1 - 4);
  return (
    <Box flexDirection="column" borderStyle={selected ? "double" : "round"} borderColor={selected ? "green" : COLOR[status]} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">{displayName(id)}</Text>
        </Box>
        <Text color={COLOR[status]}>{STATUS_ICON[status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {pending}</Text>
        </Box>
        <Text dimColor>{s?.completed ?? 0} ✓</Text>
      </Box>
      <PrioRow p="high" count={sizes.high} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="normal" count={sizes.normal} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="low" count={sizes.low} max={max} barWidth={barWidth} showLabel={wide} />
    </Box>
  );
};

const GroupCell = (props: {
  readonly node: Group;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { node, width, selected } = props;
  return (
    <Box flexDirection="column" borderStyle={selected ? "double" : "round"} borderColor={selected ? "green" : "cyan"} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold color="cyan" wrap="truncate">
            ▸ {displayName(node.name)}
          </Text>
        </Box>
        <Text dimColor>{node.members.length}</Text>
      </Box>
      {width >= 22
        ? node.members.slice(0, 4).map((m, i) => (
            <Text key={`${node.name}-${i}`} dimColor wrap="truncate">
              {m.t === "g" ? "▸ " : "  "}
              {displayName(m.name)}
            </Text>
          ))
        : null}
    </Box>
  );
};

const Cell = (props: {
  readonly node: Node;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  if (props.node.t === "g") {
    return <GroupCell node={props.node} width={props.width} selected={props.selected} />;
  }
  const bundle = REGISTRY[props.node.name];
  if (bundle === undefined) {
    return <Box width={props.width} />;
  }
  return <QueueCell id={props.node.name} bundle={bundle} width={props.width} selected={props.selected} />;
};

// bottom bar — view-specific hint, or the command palette (reversed: top match nearest input)
const Bar = (props: {
  readonly cmd: string | null;
  readonly suggestions: ReadonlyArray<string>;
  readonly cmdSel: number;
  readonly hint: React.ReactElement;
}): React.ReactElement => {
  if (props.cmd === null) {
    return props.hint;
  }
  const sel = Math.min(props.cmdSel, Math.max(0, props.suggestions.length - 1));
  return (
    <Box flexDirection="column">
      {props.suggestions
        .map((name, i) => ({ name, i }))
        .reverse()
        .map(({ name, i }) => (
          <Box key={name} paddingX={1}>
            <Text color={i === sel ? "cyan" : undefined} dimColor={i !== sel}>
              {i === sel ? "› " : "  "}
              {displayName(name)}
              <Text dimColor> {name}</Text>
            </Text>
          </Box>
        ))}
      <Box paddingX={1} backgroundColor="gray">
        <Text color="yellowBright">: {props.cmd}</Text>
        <Text inverse> </Text>
        <Text dimColor> · Enter open · Esc cancel</Text>
      </Box>
    </Box>
  );
};

// open queue full-screen: the XL widget (live status+metrics) + the real logs tail
const FocusedQueue = (props: {
  readonly id: string;
  readonly bundle: QueueBundle;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly bar: React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { id, bundle, cols, rows, editMode } = props;
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);

  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];

  const sizes: Record<Priority, number> = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const view: View = {
    name: id,
    status: statusOf(s?.phase ?? "running", s?.paused ?? false),
    sizes,
    pending: sizes.high + sizes.normal + sizes.low,
    completed: s?.completed ?? 0,
    wait: {
      high: m?.avgWaitMillis.high ?? 0,
      normal: m?.avgWaitMillis.normal ?? 0,
      low: m?.avgWaitMillis.low ?? 0,
    },
    execution: m?.avgExecutionMillis ?? 0,
    total: m?.avgTotalMillis ?? 0,
    throughput: m?.throughputPerSec ?? 0,
    trend,
  };
  const visible = Math.max(1, rows - PAGE_HEIGHT - 3 - props.barRows);
  const tail = logs.slice(-visible);

  return (
    <Box flexDirection="column" width={cols} height={rows} borderStyle={editMode ? "double" : BLANK_BORDER} borderColor="red">
      <Box flexShrink={0}>
        <PageXL v={view} width={cols - 2} />
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
            <Text dimColor> · in-flight {s?.inFlight ?? 0}</Text>
          </Box>
          <Text dimColor>phase {s?.phase ?? "?"}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          {tail.map((l) => (
            <Box key={l.id}>
              <Box width={11}>
                <Text dimColor>{new Date(l.t).toLocaleTimeString()}</Text>
              </Box>
              <Box width={6}>
                <Text color={LEVEL_COLOR[l.level] ?? "white"}>{l.level}</Text>
              </Box>
              <Box flexGrow={1}>
                <Text>{l.message}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      {props.bar}
    </Box>
  );
};

const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const [path, setPath] = React.useState<ReadonlyArray<Group>>([TREE]);
  const [sel, setSel] = React.useState(0);
  const [focused, setFocused] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [cmd, setCmd] = React.useState<string | null>(null);
  const [cmdSel, setCmdSel] = React.useState(0);
  const [scroll, setScroll] = React.useState(0);

  const group = path[path.length - 1] ?? TREE;
  const members = group.members;

  const focusBundle = focused === null ? undefined : REGISTRY[focused];
  const pause = useAtomSet(focusBundle?.pause ?? REGISTRY[QUEUES[0] ?? ""]!.pause);
  const resume = useAtomSet(focusBundle?.resume ?? REGISTRY[QUEUES[0] ?? ""]!.resume);
  const clear = useAtomSet(focusBundle?.clear ?? REGISTRY[QUEUES[0] ?? ""]!.clear);
  const shutdown = useAtomSet(focusBundle?.shutdown ?? REGISTRY[QUEUES[0] ?? ""]!.shutdown);

  const membersRef = React.useRef<ReadonlyArray<Node>>(members);
  membersRef.current = members;
  const layoutRef = React.useRef({ perRow: 1, cellWidth: 16, focused, cmd, sel, scroll: 0, maxScroll: 0 });

  const suggestions =
    cmd === null || cmd.length === 0
      ? []
      : QUEUES.filter((name) => displayName(name).toLowerCase().includes(cmd.toLowerCase())).slice(0, 6);

  const avail = cols - 4;
  let perRow = Math.max(1, Math.floor(avail / 34));
  let cellWidth = Math.floor(avail / perRow) - 1;
  while (cellWidth > 46 && perRow < members.length) {
    perRow += 1;
    cellWidth = Math.floor(avail / perRow) - 1;
  }
  cellWidth = Math.max(16, cellWidth);
  const totalRows = Math.ceil(members.length / perRow);
  const gridH = Math.max(CELL_HEIGHT, rows - 6);
  const visibleRows = Math.max(1, Math.floor(gridH / (CELL_HEIGHT + 1)));
  const maxScroll = Math.max(0, totalRows - visibleRows);
  const selRow = Math.floor(sel / perRow);
  const effScroll = Math.min(scroll, maxScroll);
  layoutRef.current = { perRow, cellWidth, focused, cmd, sel, scroll: effScroll, maxScroll };

  React.useEffect(() => {
    setScroll((sc) => {
      if (selRow < sc) {
        return selRow;
      }
      if (selRow > sc + visibleRows - 1) {
        return Math.max(0, selRow - visibleRows + 1);
      }
      return Math.min(sc, maxScroll);
    });
  }, [selRow, visibleRows, maxScroll]);

  React.useEffect(() => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (stdin.isTTY !== true) {
      return;
    }
    stdout.write("\x1b[?1000h\x1b[?1006h");
    const GRID_TOP = 4;
    const GRID_LEFT = 3;
    const onData = (data: Buffer) => {
      const re = /\[<(\d+);(\d+);(\d+)([Mm])/g;
      let mt: RegExpExecArray | null;
      const text = data.toString("utf8");
      while ((mt = re.exec(text)) !== null) {
        const button = Number(mt[1]);
        const x = Number(mt[2]);
        const y = Number(mt[3]);
        const press = mt[4] === "M";
        const v = layoutRef.current;
        if (button === 64) {
          setScroll((sc) => Math.max(0, sc - 1));
        } else if (button === 65) {
          setScroll((sc) => Math.min(v.maxScroll, sc + 1));
        } else if (button === 0 && press && v.focused === null && v.cmd === null) {
          const row = Math.floor((y - GRID_TOP) / (CELL_HEIGHT + 1));
          const col = Math.floor((x - GRID_LEFT) / (v.cellWidth + 1));
          if (row < 0 || col < 0 || col >= v.perRow) {
            continue;
          }
          const idx = (v.scroll + row) * v.perRow + col;
          const node = membersRef.current[idx];
          if (node === undefined) {
            continue;
          }
          if (idx === v.sel) {
            if (node.t === "g") {
              setPath((p) => [...p, node]);
              setSel(0);
            } else {
              setFocused(node.name);
            }
          } else {
            setSel(idx);
          }
        }
      }
    };
    stdin.on("data", onData);
    return () => {
      stdout.write("\x1b[?1000l\x1b[?1006l");
      stdin.off("data", onData);
    };
  }, []);

  const open = (node: Node | undefined) => {
    if (node === undefined) {
      return;
    }
    if (node.t === "g") {
      setPath((p) => [...p, node]);
      setSel(0);
    } else {
      setFocused(node.name);
    }
  };
  const back = () => {
    if (focused !== null) {
      setFocused(null);
    } else if (path.length > 1) {
      setPath((p) => p.slice(0, -1));
      setSel(0);
    }
  };

  useInput((input, key) => {
    if (cmd !== null) {
      if (key.return) {
        const pick = suggestions[cmdSel] ?? suggestions[0];
        setCmd(null);
        if (pick !== undefined) {
          setFocused(pick);
        }
      } else if (key.escape) {
        setCmd(null);
      } else if (key.upArrow) {
        setCmdSel((s) => Math.min(suggestions.length - 1, s + 1));
      } else if (key.downArrow) {
        setCmdSel((s) => Math.max(0, s - 1));
      } else if (key.backspace || key.delete) {
        setCmd((c) => (c ?? "").slice(0, -1));
        setCmdSel(0);
      } else if (input.length > 0 && !key.ctrl && !key.meta) {
        setCmd((c) => (c ?? "") + input);
        setCmdSel(0);
      }
      return;
    }
    if (key.ctrl && input === "e") {
      setEditMode((x) => !x);
      return;
    }
    if (input === ":") {
      setCmd("");
      setCmdSel(0);
      return;
    }
    if (key.escape || key.backspace || key.delete) {
      back();
      return;
    }
    if (focused !== null) {
      if (!editMode) {
        return;
      }
      if (input === "p") {
        pause();
      } else if (input === "r") {
        resume();
      } else if (input === "c") {
        clear();
      } else if (input === "x") {
        shutdown();
      }
      return;
    }
    if (input === "h" || key.leftArrow) {
      setSel((s) => Math.max(0, s - 1));
    } else if (input === "l" || key.rightArrow) {
      setSel((s) => Math.min(members.length - 1, s + 1));
    } else if (input === "k" || key.upArrow) {
      setSel((s) => Math.max(0, s - perRow));
    } else if (input === "j" || key.downArrow) {
      setSel((s) => Math.min(members.length - 1, s + perRow));
    } else if (key.return || input === " ") {
      open(members[Math.min(sel, members.length - 1)]);
    }
  });

  const barRows = cmd === null ? 1 : suggestions.length + 1;

  // ── focused queue ──
  if (focused !== null && focusBundle !== undefined) {
    const hint = (
      <Box paddingX={1} backgroundColor="gray">
        <Text dimColor> Esc back · </Text>
        <Text color="cyan">:</Text>
        <Text dimColor> command · </Text>
        <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT" : "view"}</Text>
        <Text dimColor>{editMode ? " Ctrl+E · [p][r][c][x]" : " Ctrl+E"}</Text>
      </Box>
    );
    return (
      <FocusedQueue
        key={focused}
        id={focused}
        bundle={focusBundle}
        cols={cols}
        rows={rows}
        editMode={editMode}
        barRows={barRows}
        bar={<Bar cmd={cmd} suggestions={suggestions} cmdSel={cmdSel} hint={hint} />}
      />
    );
  }

  // ── grid ──
  const start = effScroll * perRow;
  const visibleCells = members.slice(start, start + visibleRows * perRow);
  const more = totalRows - (effScroll + visibleRows);
  const crumb = path.map((g) => displayName(g.name)).join(" / ");

  return (
    <Box flexDirection="column" width={cols} height={rows} borderStyle={editMode ? "double" : BLANK_BORDER} borderColor="red">
      <Box paddingX={1}>
        <Text bold color="black" backgroundColor="cyan">
          {` ⬢ ${crumb} `}
        </Text>
        <Text dimColor>
          {" "}
          {members.length} items{path.length > 1 ? " · Esc up" : ""}
          {effScroll > 0 ? ` · ↑${effScroll}` : ""}
          {more > 0 ? ` · ↓${more}` : ""}
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
        {visibleCells.map((node, i) => (
          <Cell key={`${node.t}-${node.name}`} node={node} width={cellWidth} selected={start + i === sel} />
        ))}
      </Box>

      <Bar
        cmd={cmd}
        suggestions={suggestions}
        cmdSel={cmdSel}
        hint={
          <Box paddingX={1} backgroundColor="gray">
            <Text dimColor>{" ↑↓←→ move · Enter open · "}</Text>
            <Text color="cyan">:</Text>
            <Text dimColor> command · </Text>
            <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT" : "view"}</Text>
            <Text dimColor> Ctrl+E</Text>
          </Box>
        }
      />
    </Box>
  );
};

const out = process.stdout;
const tty = out.isTTY === true;
const restore = () => {
  if (tty) {
    out.write("\x1b[?1000l\x1b[?1006l\x1b[?1049l");
  }
};
if (tty) {
  out.write("\x1b[?1049h\x1b[2J\x1b[H");
}
process.on("exit", restore);
render(
  <RegistryProvider>
    <App />
  </RegistryProvider>,
);
