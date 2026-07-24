/**
 * @module examples/resource-tui/dashboard
 *
 * The navigable dashboard on the **shared, tag-driven data layer** (`../web-dashboard`)
 * — the same `Fleet` group tag + `queueBundle`/`daemonBundle` the web dashboard uses,
 * reached over http (env-aware transport: direct `:7777`/`:7778` from Node). No mock,
 * no `REGISTRY`/`TREE`. The `Group.Tag` tree IS the navigation; each leaf is dispatched
 * to a queue or process cell by `kindOf`; opening one shows the live detail page.
 *
 *   ↑↓←→ / hjkl  move · Enter/Space open or drill · Esc/Backspace back/up
 *   mouse  wheel scrolls, click selects, click again opens
 *   :  command bar (type any part of a tag name) · Ctrl+E edit mode · Ctrl+C quit
 *
 *   pnpm run example:queue-server  +  example:mini-server  (then this)
 *   pnpm run example:dashboard
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../../src/Group";
import { Fleet } from "../web-dashboard/fleet";
import {
  nodeOf,
  isDaemonLeaf,
  isQueueLeaf,
  daemonBundle,
  daemonLeaves,
  queueBundle,
  queueLeaves,
  type CommandAtom,
  type GroupNode,
  type LeafTag,
  type DaemonTag,
} from "../web-dashboard/queue-data";
import { RegistryProvider, useAtomSet, useAtomValue } from "../../src/ui/atom-react";
import {
  bar,
  BLANK_BORDER,
  COLOR,
  compact,
  displayName,
  PageXL,
  PAGE_HEIGHT,
  STATUS_ICON,
  type Priority,
  type Status,
  type View,
} from "./queue-widget";

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

// ── tag dispatch ──────────────────────────────────────────────────────────────
// A leaf tag carries no discriminant TS can narrow on, so `kindOf` (which inspects the
// contract) becomes a type guard — the sanctioned alternative to a cast.
const isDaemonTag = (m: unknown): m is DaemonTag => isDaemonLeaf(m);
const isQueueTag = (m: unknown): m is LeafTag => isQueueLeaf(m);
/** Every leaf (queue + daemon) of the fleet — the command palette's targets. */
const ALL_LEAVES: ReadonlyArray<LeafTag | DaemonTag> = [...queueLeaves(Fleet), ...daemonLeaves(Fleet)];

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

// one priority's bar — symbol · bar · compact count (no text label: keeps the row clean
// at any cell width and never overflows the border, even with deep live queues).
const PrioRow = (props: {
  readonly p: Priority;
  readonly count: number;
  readonly max: number;
  readonly barWidth: number;
}): React.ReactElement => {
  const s = SYM[props.p];
  return (
    <Box>
      <Box width={2}>
        <Text>{s.symbol}</Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(props.count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text>{compact(props.count)}</Text>
      </Box>
    </Box>
  );
};

// the ⬡ node marker (Mini), shown on resources that don't run on the Droplet
const NodeMark = (props: { readonly tagKey: string }): React.ReactElement | null => {
  const node = nodeOf(props.tagKey);
  return node === undefined ? null : <Text color="cyan"> ⬡ {node}</Text>;
};

// a queue grid cell — reads its own live status straight from the tag
const QueueCell = (props: {
  readonly tag: LeafTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { tag, width, selected } = props;
  const r = useAtomValue(queueBundle(tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const status = statusOf(s?.phase ?? "running", s?.paused ?? false);
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  // interior = width − borders(2) − paddingX(2); row = symbol(2) · bar(barWidth+1) · count(5)
  const barWidth = Math.max(4, width - 4 - 2 - 1 - 5);
  return (
    <Box flexDirection="column" borderStyle={selected ? "double" : "round"} borderColor={selected ? "green" : COLOR[status]} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">{displayName(tag.key)}</Text>
          <NodeMark tagKey={tag.key} />
        </Box>
        <Text color={COLOR[status]}>{STATUS_ICON[status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {compact(pending)}</Text>
        </Box>
        <Text dimColor>{compact(s?.completed ?? 0)} ✓</Text>
      </Box>
      <PrioRow p="high" count={sizes.high} max={max} barWidth={barWidth} />
      <PrioRow p="normal" count={sizes.normal} max={max} barWidth={barWidth} />
      <PrioRow p="low" count={sizes.low} max={max} barWidth={barWidth} />
    </Box>
  );
};

// a process grid cell — supervision state + active instances
const DaemonCell = (props: {
  readonly tag: DaemonTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { tag, width, selected } = props;
  const r = useAtomValue(daemonBundle(tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const up = s?.supervising === true;
  return (
    <Box flexDirection="column" borderStyle={selected ? "double" : "round"} borderColor={selected ? "green" : up ? "green" : "gray"} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">⚙ {displayName(tag.key)}</Text>
          <NodeMark tagKey={tag.key} />
        </Box>
        <Text color={up ? "green" : "gray"}>{up ? "►" : "■"}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>{up ? "running" : "stopped"}</Text>
        </Box>
        <Text dimColor>{s?.armed === true ? "armed" : "disarmed"}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>active </Text>
        <Text bold>{s?.activeInstances ?? 0}</Text>
      </Box>
    </Box>
  );
};

const GroupCell = (props: {
  readonly node: GroupNode;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { node, width, selected } = props;
  const members = Object.values(Group.members(node));
  const leafCount = leafCountOf(node);
  return (
    <Box flexDirection="column" borderStyle={selected ? "double" : "round"} borderColor={selected ? "green" : "cyan"} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold color="cyan" wrap="truncate">
            ▸ {displayName(node.key)}
          </Text>
        </Box>
        <Text dimColor>{leafCount}</Text>
      </Box>
      {width >= 22
        ? members.slice(0, 4).map((m, i) => (
            <Text key={`${node.key}-${i}`} dimColor wrap="truncate">
              {Group.isGroup(m) ? "▸ " : isDaemonTag(m) ? "⚙ " : "  "}
              {displayName(idOf(m))}
            </Text>
          ))
        : null}
    </Box>
  );
};

const Cell = (props: {
  readonly member: unknown;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  if (Group.isGroup(props.member)) {
    return <GroupCell node={props.member} width={props.width} selected={props.selected} />;
  }
  if (isDaemonTag(props.member)) {
    return <DaemonCell tag={props.member} width={props.width} selected={props.selected} />;
  }
  if (isQueueTag(props.member)) {
    return <QueueCell tag={props.member} width={props.width} selected={props.selected} />;
  }
  return <Box width={props.width} />;
};

// ── nav helpers ───────────────────────────────────────────────────────────────
/** Every leaf reachable under a node (recursing into subgroups). */
const leafCountOf = (node: GroupNode): number =>
  Object.values(Group.members(node)).reduce<number>((n, m) => n + (Group.isGroup(m) ? leafCountOf(m) : 1), 0);
/** Display key of any nav member (group node or leaf tag). */
const idOf = (m: unknown): string =>
  Group.isGroup(m) ? m.key : isDaemonTag(m) || isQueueTag(m) ? m.key : "";

// bottom bar — view-specific hint, or the command palette (reversed: top match nearest input)
const Bar = (props: {
  readonly cmd: string | null;
  readonly suggestions: ReadonlyArray<LeafTag | DaemonTag>;
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
        .map((tag, i) => ({ tag, i }))
        .reverse()
        .map(({ tag, i }) => (
          <Box key={tag.key} paddingX={1}>
            <Text color={i === sel ? "cyan" : undefined} dimColor={i !== sel}>
              {i === sel ? "› " : "  "}
              {isDaemonTag(tag) ? "⚙ " : ""}
              {displayName(tag.key)}
              <Text dimColor> {tag.key}</Text>
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

// a control key with round-trip feedback: idle → … (in-flight) → ✓ (ack) / ✗ (failed)
const ControlKey = (props: {
  readonly k: string;
  readonly label: string;
  readonly atom: CommandAtom;
}): React.ReactElement => {
  const r = useAtomValue(props.atom);
  const pending = AsyncResult.isWaiting(r);
  const failed = AsyncResult.isFailure(r) && !pending;
  const [flash, setFlash] = React.useState(false);
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current && AsyncResult.isSuccess(r)) {
      wasPending.current = false;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    return;
  }, [pending, r]);
  const sym = pending ? " …" : flash ? " ✓" : failed ? " ✗" : "";
  const color = failed ? "red" : flash ? "green" : pending ? "yellow" : "gray";
  return (
    <Text color={color}>
      [{props.k}]{props.label}
      {sym}{" "}
    </Text>
  );
};

// the live log tail — newest at the bottom
const LogTail = (props: {
  readonly logs: ReadonlyArray<{ readonly id: number; readonly t: number; readonly level: string; readonly message: string }>;
  readonly visible: number;
}): React.ReactElement => (
  <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
    {props.logs.slice(-props.visible).map((l) => (
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
);

// open queue full-screen: the XL widget (live status+metrics) + the real logs tail
const FocusedQueue = (props: {
  readonly tag: LeafTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly cmd: string | null;
  readonly bar: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { tag, cols, rows, editMode } = props;
  const bundle = queueBundle(tag);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);

  // keep the command atoms mounted + grab their triggers for the keyboard controls
  const pause = useAtomSet(bundle.pause);
  const resume = useAtomSet(bundle.resume);
  const clear = useAtomSet(bundle.clear);
  const shutdown = useAtomSet(bundle.shutdown);
  useInput(
    (input) => {
      if (input === "p") pause();
      else if (input === "r") resume();
      else if (input === "c") clear();
      else if (input === "x") shutdown();
    },
    { isActive: editMode && props.cmd === null },
  );

  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];

  const sizes: Record<Priority, number> = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const view: View = {
    name: tag.key,
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

  const hint = (
    <Box paddingX={1} backgroundColor="gray">
      <Text dimColor> Esc back · </Text>
      <Text color="cyan">:</Text>
      <Text dimColor> command · </Text>
      <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT " : "view "}</Text>
      {editMode ? (
        <>
          <ControlKey k="p" label="pause" atom={bundle.pause} />
          <ControlKey k="r" label="resume" atom={bundle.resume} />
          <ControlKey k="c" label="clear" atom={bundle.clear} />
          <ControlKey k="x" label="shutdown" atom={bundle.shutdown} />
        </>
      ) : (
        <Text dimColor>Ctrl+E edit</Text>
      )}
    </Box>
  );

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
            <NodeMark tagKey={tag.key} />
          </Box>
          <Text dimColor>phase {s?.phase ?? "?"}</Text>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {props.bar(hint)}
    </Box>
  );
};

// open process full-screen: supervision stats + the real logs tail
const FocusedDaemon = (props: {
  readonly tag: DaemonTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly cmd: string | null;
  readonly bar: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { tag, cols, rows, editMode } = props;
  const bundle = daemonBundle(tag);
  const statusR = useAtomValue(bundle.status);
  const logsR = useAtomValue(bundle.logs);

  const start = useAtomSet(bundle.start);
  const stop = useAtomSet(bundle.stop);
  const runNow = useAtomSet(bundle.run);
  useInput(
    (input) => {
      if (input === "s") start();
      else if (input === "x") stop();
      else if (input === "n") runNow();
    },
    { isActive: editMode && props.cmd === null },
  );

  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const up = s?.supervising === true;
  const visible = Math.max(1, rows - 8 - props.barRows);

  const hint = (
    <Box paddingX={1} backgroundColor="gray">
      <Text dimColor> Esc back · </Text>
      <Text color="cyan">:</Text>
      <Text dimColor> command · </Text>
      <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT " : "view "}</Text>
      {editMode ? (
        <>
          <ControlKey k="s" label="start" atom={bundle.start} />
          <ControlKey k="x" label="stop" atom={bundle.stop} />
          <ControlKey k="n" label="run now" atom={bundle.run} />
        </>
      ) : (
        <Text dimColor>Ctrl+E edit</Text>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" width={cols} height={rows} borderStyle={editMode ? "double" : BLANK_BORDER} borderColor="red">
      <Box flexDirection="column" borderStyle="round" borderColor={up ? "green" : "gray"} paddingX={2} paddingY={1} marginX={1} marginTop={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            ⚙ {displayName(tag.key)}
            <NodeMark tagKey={tag.key} />
          </Text>
          <Text color={up ? "green" : "gray"}>{up ? "► running" : "■ stopped"}</Text>
        </Box>
        <Box marginTop={1}>
          <Box width={24}>
            <Text>supervising {up ? "yes" : "no"}</Text>
          </Box>
          <Box width={20}>
            <Text>armed {s?.armed === true ? "yes" : "no"}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text>active {s?.activeInstances ?? 0}</Text>
          </Box>
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
          </Box>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {props.bar(hint)}
    </Box>
  );
};

export const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const [path, setPath] = React.useState<ReadonlyArray<GroupNode>>([Fleet]);
  const [sel, setSel] = React.useState(0);
  const [focused, setFocused] = React.useState<LeafTag | DaemonTag | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [cmd, setCmd] = React.useState<string | null>(null);
  const [cmdSel, setCmdSel] = React.useState(0);
  const [scroll, setScroll] = React.useState(0);

  const group = path[path.length - 1] ?? Fleet;
  const members = Object.values(Group.members(group));

  const membersRef = React.useRef<ReadonlyArray<unknown>>(members);
  membersRef.current = members;
  const layoutRef = React.useRef({ perRow: 1, cellWidth: 16, focused, cmd, sel, scroll: 0, maxScroll: 0 });

  const suggestions =
    cmd === null || cmd.length === 0
      ? []
      : ALL_LEAVES.filter((tag) => displayName(tag.key).toLowerCase().includes(cmd.toLowerCase())).slice(0, 6);

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
            open(node);
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

  // tags are classes (functions) — wrap in an updater so React doesn't treat the tag as
  // a lazy state initializer ("Cannot call a class constructor without new").
  const open = (member: unknown) => {
    if (Group.isGroup(member)) {
      setPath((p) => [...p, member]);
      setSel(0);
    } else if (isDaemonTag(member) || isQueueTag(member)) {
      setFocused(() => member);
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
          setFocused(() => pick);
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
    // in the focused view the control keys are owned by the focused component's own
    // useInput (gated on edit mode) — App only handles back / command / edit toggle.
    if (focused !== null) {
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
  const renderBar = (hint: React.ReactElement) => (
    <Bar cmd={cmd} suggestions={suggestions} cmdSel={cmdSel} hint={hint} />
  );

  // ── focused resource ──
  if (focused !== null) {
    return isDaemonTag(focused) ? (
      <FocusedDaemon
        key={focused.key}
        tag={focused}
        cols={cols}
        rows={rows}
        editMode={editMode}
        cmd={cmd}
        barRows={barRows}
        bar={renderBar}
      />
    ) : (
      <FocusedQueue
        key={focused.key}
        tag={focused}
        cols={cols}
        rows={rows}
        editMode={editMode}
        cmd={cmd}
        barRows={barRows}
        bar={renderBar}
      />
    );
  }

  // ── grid ──
  const start = effScroll * perRow;
  const visibleCells = members.slice(start, start + visibleRows * perRow);
  const more = totalRows - (effScroll + visibleRows);
  const crumb = path.map((g) => displayName(g.key)).join(" / ");

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
          <Cell key={idOf(node)} member={node} width={cellWidth} selected={start + i === sel} />
        ))}
      </Box>

      {renderBar(
        <Box paddingX={1} backgroundColor="gray">
          <Text dimColor>{" ↑↓←→ move · Enter open · "}</Text>
          <Text color="cyan">:</Text>
          <Text dimColor> command · </Text>
          <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT" : "view"}</Text>
          <Text dimColor> Ctrl+E</Text>
        </Box>,
      )}
    </Box>
  );
};

/** Launch the dashboard: enter the alt-screen, render the Ink app, restore on exit.
 *  Called by the `dashboard.tsx` entry and by `hyperlink` (no subcommand → the TUI). */
export const runDashboard = (): void => {
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
};
