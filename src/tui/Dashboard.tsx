/**
 * @module tui/Dashboard
 *
 * The Ink Group dashboard — terminal counterpart to `<Dashboard runtime group />` from
 * `hyperlink-ts/web`. Same `Group` tree, same `hyperlink-ts/ui` data bundles, same path
 * model (member nickname chain); Ink instead of DOM. Bare CLI paths open this via {@link layer}.
 *
 * ```tsx
 * <Dashboard runtime={Atom.runtime(appLayer)} group={Fleet} />
 * <Dashboard runtime={runtime} group={Fleet} path={["Mail"]} />
 * ```
 *
 *   ↑↓←→ / hjkl  move · Enter/Space open or drill · Esc/Backspace back/up
 *   mouse  wheel scrolls, click selects, click again opens
 *   :  command bar · Ctrl+E edit mode · Ctrl+C quit
 *
 */
import { Box, Text, useInput, useStdout } from "ink";
import * as React from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import { kindOf as hyperlinkKindOf, nodeOf } from "../Hyperlink";
import {
  daemonBundle,
  daemonLeaves,
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  priorityBundle,
  queueBundle,
  queueLeaves,
  type CommandAtom,
  type DaemonTag,
  type DashboardRuntime,
  type GroupNode,
  type PriorityTag,
  type QueueTag,
} from "../ui/data";
import { RegistryProvider, useAtomSet, useAtomValue } from "../ui/atom-react";
import { WidgetsProvider } from "../ui/widgetsContext";
import { spark } from "./chrome";
import { base, Cell, type TuiWidgetRegistry } from "./cellWidgets";
import {
  FocusedApi,
  FocusedFleetHealth,
  FocusedGate,
  FocusedShardMap,
  FocusedTelemetry,
} from "./kindCells";
import { RuntimeProvider, useRuntime } from "./runtime";
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
} from "./queueWidget";
import { useGroupRoute } from "./useGroupRoute";

const CELL_HEIGHT = 7;
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

const idOf = (m: unknown): string => {
  if (Group.isGroup(m)) return m.key;
  if (
    (typeof m === "object" || typeof m === "function") &&
    m !== null &&
    "key" in m &&
    typeof m.key === "string"
  ) {
    return m.key;
  }
  return "";
};

const NodeMark = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = nodeOf(props.tag);
  if (node === undefined) return null;
  return <Text color="cyan"> ⬡ {displayName(node.key)}</Text>;
};

const Bar = (props: {
  readonly cmd: string | null;
  readonly suggestions: ReadonlyArray<QueueTag | DaemonTag>;
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

const LogTail = (props: {
  readonly logs: ReadonlyArray<{
    readonly id: number;
    readonly t: number;
    readonly level: string;
    readonly message: string;
  }>;
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

const FocusedQueue = (props: {
  readonly name: string;
  readonly tag: QueueTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly cmd: string | null;
  readonly bar: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { name, tag, cols, rows, editMode } = props;
  const bundle = queueBundle(useRuntime(), tag);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);

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

  const statusOpt = AsyncResult.isSuccess(statusR) ? statusR.value : Option.none();
  const s = Option.isSome(statusOpt) ? statusOpt.value : undefined;
  const metricsOpt = AsyncResult.isSuccess(metricsR) ? metricsR.value : Option.none();
  const m = Option.isSome(metricsOpt) ? metricsOpt.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];

  const sizes: Record<Priority, number> = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const view: View = {
    name,
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
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box flexShrink={0}>
        <PageXL v={view} width={cols - 2} />
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
            <Text dimColor> · in-flight {s?.inFlight ?? 0}</Text>
            <NodeMark tag={tag} />
          </Box>
          <Text dimColor>phase {s?.phase ?? "?"}</Text>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {props.bar(hint)}
    </Box>
  );
};

const FocusedPriority = (props: {
  readonly name: string;
  readonly tag: PriorityTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly cmd: string | null;
  readonly bar: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { name, tag, cols, rows, editMode } = props;
  const bundle = priorityBundle(useRuntime(), tag);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);

  const start = useAtomSet(bundle.start);
  const pause = useAtomSet(bundle.pause);
  const resume = useAtomSet(bundle.resume);
  const clear = useAtomSet(bundle.clear);
  const shutdown = useAtomSet(bundle.shutdown);
  useInput(
    (input) => {
      if (input === "s") start();
      else if (input === "p") pause();
      else if (input === "r") resume();
      else if (input === "c") clear();
      else if (input === "x") shutdown();
    },
    { isActive: editMode && props.cmd === null },
  );

  const statusOpt = AsyncResult.isSuccess(statusR) ? statusR.value : Option.none();
  const s = Option.isSome(statusOpt) ? statusOpt.value : undefined;
  const metricsOpt = AsyncResult.isSuccess(metricsR) ? metricsR.value : Option.none();
  const m = Option.isSome(metricsOpt) ? metricsOpt.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const status = statusOf(s?.phase ?? "running", s?.paused ?? false);
  const visible = Math.max(1, rows - 12 - props.barRows);
  const barWidth = Math.max(8, cols - 30);

  const hint = (
    <Box paddingX={1} backgroundColor="gray">
      <Text dimColor> Esc back · </Text>
      <Text color="cyan">:</Text>
      <Text dimColor> command · </Text>
      <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT " : "view "}</Text>
      {editMode ? (
        <>
          <ControlKey k="s" label="start" atom={bundle.start} />
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
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLOR[status]}
        paddingX={2}
        paddingY={1}
        marginX={1}
        marginTop={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            {name}
            <NodeMark tag={tag} />
          </Text>
          <Text color={COLOR[status]}>
            {STATUS_ICON[status]} {status}
          </Text>
        </Box>
        <Box marginTop={1} justifyContent="space-between">
          <Text bold>PENDING {pending}</Text>
          <Text bold>COMPLETED {s?.completed ?? 0}</Text>
          <Text dimColor>
            {m?.throughputPerSec.toFixed(1) ?? "0.0"}/s · in-flight {s?.inFlight ?? 0}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {lanes.slice(0, 8).map(([lane, count]) => (
            <Box key={lane}>
              <Box width={12}>
                <Text wrap="truncate">{lane}</Text>
              </Box>
              <Box width={barWidth + 1}>
                <Text>{bar(count, max, barWidth)}</Text>
              </Box>
              <Box width={6} justifyContent="flex-end">
                <Text>{compact(count)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="green">{spark(trend)}</Text>
          <Text dimColor> pending · last {trend.length}s</Text>
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Text dimColor>LOGS </Text>
          <Text color="green">live</Text>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {props.bar(hint)}
    </Box>
  );
};

const FocusedDaemon = (props: {
  readonly name: string;
  readonly tag: DaemonTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode: boolean;
  readonly cmd: string | null;
  readonly bar: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows: number;
}): React.ReactElement => {
  const { name, tag, cols, rows, editMode } = props;
  const bundle = daemonBundle(useRuntime(), tag);
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
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={up ? "green" : "gray"}
        paddingX={2}
        paddingY={1}
        marginX={1}
        marginTop={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            ⚙ {name}
            <NodeMark tag={tag} />
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

const DashboardApp = (props: {
  readonly group: GroupNode;
  readonly path: ReadonlyArray<string>;
}): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const route = useGroupRoute(props.group, props.path);
  const [sel, setSel] = React.useState(0);
  const [editMode, setEditMode] = React.useState(false);
  const [cmd, setCmd] = React.useState<string | null>(null);
  const [cmdSel, setCmdSel] = React.useState(0);
  const [scroll, setScroll] = React.useState(0);

  const members = Object.entries(Group.members(route.group));
  const allLeaves: ReadonlyArray<QueueTag | DaemonTag> = [
    ...queueLeaves(props.group),
    ...daemonLeaves(props.group),
  ];

  const membersRef = React.useRef(members);
  membersRef.current = members;
  const layoutRef = React.useRef({
    perRow: 1,
    cellWidth: 16,
    selected: route.selected,
    cmd,
    sel,
    scroll: 0,
    maxScroll: 0,
  });

  const suggestions =
    cmd === null || cmd.length === 0
      ? []
      : allLeaves
          .filter((tag) => displayName(tag.key).toLowerCase().includes(cmd.toLowerCase()))
          .slice(0, 6);

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
  layoutRef.current = {
    perRow,
    cellWidth,
    selected: route.selected,
    cmd,
    sel,
    scroll: effScroll,
    maxScroll,
  };

  React.useEffect(() => {
    setSel(0);
    setScroll(0);
  }, [route.group.key, route.keys.join("/")]);

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
        } else if (button === 0 && press && v.selected === null && v.cmd === null) {
          const row = Math.floor((y - GRID_TOP) / (CELL_HEIGHT + 1));
          const col = Math.floor((x - GRID_LEFT) / (v.cellWidth + 1));
          if (row < 0 || col < 0 || col >= v.perRow) {
            continue;
          }
          const idx = (v.scroll + row) * v.perRow + col;
          const entry = membersRef.current[idx];
          if (entry === undefined) {
            continue;
          }
          if (idx === v.sel) {
            route.open(entry[0]);
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
  }, [route]);

  useInput((input, key) => {
    if (cmd !== null) {
      if (key.return) {
        const pick = suggestions[cmdSel] ?? suggestions[0];
        setCmd(null);
        if (pick !== undefined) {
          route.goToLeaf(pick.key);
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
      route.back();
      return;
    }
    if (route.selected !== null) {
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
      const entry = members[Math.min(sel, members.length - 1)];
      if (entry !== undefined) route.open(entry[0]);
    }
  });

  const barRows = cmd === null ? 1 : suggestions.length + 1;
  const renderBar = (hint: React.ReactElement) => (
    <Bar cmd={cmd} suggestions={suggestions} cmdSel={cmdSel} hint={hint} />
  );

  const focused = route.selected;
  const focusName = route.keys[route.keys.length - 1] ?? displayName(idOf(focused));
  const runtime = useRuntime();
  if (focused !== null) {
    if (isDaemonTag(focused)) {
      return (
        <FocusedDaemon
          key={focused.key}
          name={focusName}
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
    if (isQueueTag(focused)) {
      return (
        <FocusedQueue
          key={focused.key}
          name={focusName}
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
    if (isPriorityTag(focused)) {
      return (
        <FocusedPriority
          key={focused.key}
          name={focusName}
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
    if (isGateTag(focused)) {
      return (
        <FocusedGate
          key={focused.key}
          runtime={runtime}
          name={focusName}
          tag={focused}
          cols={cols}
          rows={rows}
        />
      );
    }
    if (isApiTag(focused)) {
      return (
        <FocusedApi
          key={focused.key}
          runtime={runtime}
          name={focusName}
          tag={focused}
          cols={cols}
          rows={rows}
        />
      );
    }
    if (isFleetHealthTag(focused)) {
      return (
        <FocusedFleetHealth
          key={focused.key}
          runtime={runtime}
          name={focusName}
          tag={focused}
          cols={cols}
          rows={rows}
        />
      );
    }
    if (isTelemetryTag(focused)) {
      return (
        <FocusedTelemetry
          key={focused.key}
          runtime={runtime}
          name={focusName}
          tag={focused}
          cols={cols}
          rows={rows}
        />
      );
    }
    if (isShardMapTag(focused)) {
      return (
        <FocusedShardMap
          key={focused.key}
          runtime={runtime}
          name={focusName}
          tag={focused}
          cols={cols}
          rows={rows}
        />
      );
    }
    const kind = hyperlinkKindOf(focused) ?? "unknown";
    const node = nodeOf(focused);
    return (
      <Box flexDirection="column" width={cols} height={rows}>
        <Box paddingX={1}>
          <Text bold>{focusName}</Text>
          <Text dimColor> · Esc back</Text>
        </Box>
        <Box paddingX={1} marginTop={1} flexDirection="column">
          <Text>
            kind <Text color="cyan">{kind}</Text>
          </Text>
          {node !== undefined ? (
            <Text>
              node <Text color="cyan">⬡ {displayName(node.key)}</Text>
            </Text>
          ) : (
            <Text dimColor>no node bind</Text>
          )}
          <Box marginTop={1}>
            <Text dimColor>No richer terminal detail for this kind yet.</Text>
          </Box>
        </Box>
        {renderBar(
          <Box paddingX={1} backgroundColor="gray">
            <Text dimColor> Esc back</Text>
          </Box>,
        )}
      </Box>
    );
  }

  const start = effScroll * perRow;
  const visibleCells = members.slice(start, start + visibleRows * perRow);
  const more = totalRows - (effScroll + visibleRows);
  // Root uses the group's tag short name; deeper segments are member nicknames (`route.keys`).
  const crumb = [displayName(props.group.key), ...route.keys].join(" / ");

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box paddingX={1}>
        <Text bold color="black" backgroundColor="cyan">
          {` ⬢ ${crumb} `}
        </Text>
        <Text dimColor>
          {" "}
          {members.length} items{route.trail.length > 1 ? " · Esc up" : ""}
          {effScroll > 0 ? ` · ↑${effScroll}` : ""}
          {more > 0 ? ` · ↓${more}` : ""}
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
        {visibleCells.map(([name, node], i) => (
          <Cell
            key={name}
            name={name}
            member={node}
            width={cellWidth}
            selected={start + i === sel}
          />
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

/**
 * Batteries-included terminal dashboard: registry + Group drill-down.
 * `<Dashboard runtime={Atom.runtime(layer)} group={Fleet} />`.
 *
 * @public
 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /** CLI / deep-link focus as member-key nicknames (`["Inbox"]`, `["Mini", "KeyRotation"]`). */
  readonly path?: ReadonlyArray<string>;
  /** Cell set (defaults to {@link base}); extend with `withEntries(base, [forKind(...), forKey(...)])`. */
  readonly widgets?: TuiWidgetRegistry;
}): React.ReactElement => (
  <RegistryProvider>
    <WidgetsProvider registry={props.widgets ?? base}>
      <RuntimeProvider runtime={props.runtime}>
        <DashboardApp group={props.group} path={props.path ?? []} />
      </RuntimeProvider>
    </WidgetsProvider>
  </RegistryProvider>
);
