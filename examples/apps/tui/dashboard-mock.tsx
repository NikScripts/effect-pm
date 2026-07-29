/**
 * @module examples/apps/tui/dashboard-mock
 *
 * Navigable group dashboard. A responsive grid of widgets you move through:
 *   ↑↓←→ / hjkl  move selection
 *   Enter / Space  open a queue full-screen · or drill into a subgroup
 *   mouse  wheel moves the selection a row; click selects a cell, click it again to open
 *   Esc / Backspace  back (close the queue, or up a level for nested groups)
 *   :  command bar — type any part of a tag's name (any case) for autocomplete
 *   Ctrl+E  edit mode (resource controls) · Ctrl+C  quit
 *
 * Names are full tag keys (@acme/queues/MailQueue); the display name is the last
 * `/` segment. Live: queues produce/drain on their own and stream events (shown in
 * the open queue's log tail).
 *
 *   pnpm run example:dashboard
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import {
  BLANK_BORDER,
  PageXL,
  PAGE_HEIGHT,
  displayName,
  type Priority,
  type Status,
  type View,
} from "./queue-widget";

type Kind = "completed" | "failed" | "retry";
type Node =
  | { readonly t: "q"; readonly name: string }
  | { readonly t: "g"; readonly name: string; readonly members: ReadonlyArray<Node> };
type Group = Extract<Node, { t: "g" }>;

const COLOR: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  draining: "cyan",
  off: "red",
};
const ICON: Record<Status, string> = {
  running: "►",
  paused: "‖",
  draining: "↓",
  off: "■",
};
const SYM: Record<Priority, { symbol: string; color: string }> = {
  high: { symbol: "▲", color: "red" },
  normal: { symbol: "•", color: "white" },
  low: { symbol: "▼", color: "blue" },
};
const LOG: Record<Kind, { icon: string; color: string; label: string }> = {
  completed: { icon: "✓", color: "green", label: "done" },
  failed: { icon: "✗", color: "red", label: "failed" },
  retry: { icon: "~", color: "yellow", label: "retry" },
};
const WAIT_FACTOR: Record<Priority, number> = { high: 350, normal: 700, low: 1600 };
// uniform cell height keeps mouse hit-testing a clean stride
const CELL_HEIGHT = 7;

const k = (n: string): string => `@acme/queues/${n}`;
const TREE: Group = {
  t: "g",
  name: k("Ops"),
  members: [
    { t: "q", name: k("Mail") },
    { t: "q", name: k("Jobs") },
    { t: "q", name: k("Billing") },
    {
      t: "g",
      name: k("Workers"),
      members: [
        { t: "q", name: k("Worker1") },
        { t: "q", name: k("Worker2") },
        { t: "q", name: k("Worker3") },
      ],
    },
    { t: "q", name: k("Notify") },
    { t: "q", name: k("Exports") },
    {
      t: "g",
      name: k("Reports"),
      members: [
        { t: "q", name: k("Daily") },
        { t: "q", name: k("Weekly") },
      ],
    },
  ],
};

const allQueues = (g: Group, acc: Array<string> = []): Array<string> => {
  for (const m of g.members) {
    if (m.t === "g") {
      allQueues(m, acc);
    } else {
      acc.push(m.name);
    }
  }
  return acc;
};
const QUEUES = allQueues(TREE);

interface Q {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
  readonly completed: number;
  readonly status: Status;
  readonly recent: ReadonlyArray<number>;
}
interface LogEntry {
  readonly id: number;
  readonly queue: string;
  readonly t: number;
  readonly kind: Kind;
  readonly key: string;
  readonly detail: string;
}

let rngState = 0x9e3779b1;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
let logId = 0;
const hexKey = (): string =>
  Math.floor(rng() * 0xffff)
    .toString(16)
    .padStart(4, "0");
const timeStr = (t: number): string => new Date(t).toLocaleTimeString();

const initQueues = (): Record<string, Q> => {
  const r: Record<string, Q> = {};
  for (const name of QUEUES) {
    r[name] = {
      high: 1 + Math.floor(rng() * 5),
      normal: 3 + Math.floor(rng() * 14),
      low: Math.floor(rng() * 6),
      completed: 50 + Math.floor(rng() * 400),
      status: "running",
      recent: [],
    };
  }
  return r;
};

const pendingOf = (q: Q): number => q.high + q.normal + q.low;
const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
};
const viewOf = (name: string, q: Q, trend: ReadonlyArray<number>): View => {
  const pending = pendingOf(q);
  const execution = 700 + (q.completed % 5) * 120;
  const overallWait =
    pending > 0
      ? (q.high * WAIT_FACTOR.high +
          q.normal * WAIT_FACTOR.normal +
          q.low * WAIT_FACTOR.low) /
        pending
      : 0;
  return {
    name,
    status: q.status,
    sizes: { high: q.high, normal: q.normal, low: q.low },
    pending,
    completed: q.completed,
    wait: {
      high: q.high * WAIT_FACTOR.high,
      normal: q.normal * WAIT_FACTOR.normal,
      low: q.low * WAIT_FACTOR.low,
    },
    execution,
    total: overallWait + execution,
    throughput: q.recent.length / 5,
    trend,
  };
};

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

const Cell = (props: {
  readonly node: Node;
  readonly queues: Record<string, Q>;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { node, queues, width, selected } = props;
  const border = selected ? "double" : "round";
  if (node.t === "g") {
    const total = node.members.reduce((sum, m) => {
      if (m.t === "g") return sum;
      const q = queues[m.name];
      return sum + (q === undefined ? 0 : pendingOf(q));
    }, 0);
    const fits = width >= 22;
    return (
      <Box flexDirection="column" borderStyle={border} borderColor={selected ? "green" : "cyan"} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text bold color="cyan" wrap="truncate">
              ▸ {displayName(node.name)}
            </Text>
          </Box>
          <Text dimColor>
            {node.members.length} · {total}
          </Text>
        </Box>
        {fits
          ? node.members.slice(0, 4).map((m, i) => (
              <Text key={`${node.name}-${i}`} dimColor wrap="truncate">
                {m.t === "g" ? "▸ " : "  "}
                {displayName(m.name)}
              </Text>
            ))
          : null}
      </Box>
    );
  }
  const q = queues[node.name];
  if (q === undefined) {
    return <Box width={width} />;
  }
  const wide = width >= 40;
  const barWidth = Math.max(4, width - 4 - (wide ? 7 : 2) - 1 - 4);
  const max = Math.max(q.high, q.normal, q.low, 1);
  return (
    <Box flexDirection="column" borderStyle={border} borderColor={selected ? "green" : COLOR[q.status]} height={CELL_HEIGHT} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">{displayName(node.name)}</Text>
        </Box>
        <Text color={COLOR[q.status]}>{ICON[q.status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {pendingOf(q)}</Text>
        </Box>
        <Text dimColor>{q.completed} ✓</Text>
      </Box>
      <PrioRow p="high" count={q.high} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="normal" count={q.normal} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="low" count={q.low} max={max} barWidth={barWidth} showLabel={wide} />
    </Box>
  );
};

// bottom bar: a view-specific hint, or the command palette when open. Suggestions
// are reversed so the top match sits nearest the input line.
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

const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const [queues, setQueues] = React.useState<Record<string, Q>>(initQueues);
  const [logs, setLogs] = React.useState<ReadonlyArray<LogEntry>>([]);
  const [trend, setTrend] = React.useState<ReadonlyArray<number>>([]);

  const [path, setPath] = React.useState<ReadonlyArray<Group>>([TREE]);
  const [sel, setSel] = React.useState(0);
  const [focused, setFocused] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [cmd, setCmd] = React.useState<string | null>(null); // null = closed
  const [cmdSel, setCmdSel] = React.useState(0);
  const [scroll, setScroll] = React.useState(0); // top visible grid row

  const group = path[path.length - 1] ?? TREE;
  const members = group.members;
  const selectedNode = members[Math.min(sel, members.length - 1)];

  const focusRef = React.useRef<string | null>(focused);
  focusRef.current = focused;

  // live layout + members for the mouse handler (one-time effect reads these)
  const membersRef = React.useRef<ReadonlyArray<Node>>(members);
  membersRef.current = members;
  const layoutRef = React.useRef({
    perRow: 1,
    cellWidth: 16,
    focused,
    cmd,
    sel,
    scroll: 0,
    maxScroll: 0,
  });

  // sim: advance all queues, stream events
  React.useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const newLogs: Array<LogEntry> = [];
      setQueues((qs) => {
        const next: Record<string, Q> = {};
        for (const name of QUEUES) {
          const s = qs[name];
          if (s === undefined) {
            continue;
          }
          let { high, normal, low, completed } = s;
          let recent = s.recent;
          if (rng() < 0.5) {
            const r = rng();
            if (r < 0.2) high += 1;
            else if (r < 0.8) normal += 1;
            else low += 1;
          }
          if (s.status === "running" && high + normal + low > 0) {
            if (high > 0) high -= 1;
            else if (normal > 0) normal -= 1;
            else low -= 1;
            const key = hexKey();
            const roll = rng();
            const kind: Kind = roll < 0.08 ? "failed" : roll < 0.14 ? "retry" : "completed";
            if (kind === "completed") {
              completed += 1;
              recent = [...recent, now].filter((t) => now - t < 5000);
            }
            logId += 1;
            newLogs.push({
              id: logId,
              queue: name,
              t: now,
              kind,
              key,
              detail:
                kind === "completed"
                  ? `${80 + Math.floor(rng() * 400)}ms`
                  : kind === "failed"
                    ? "timeout"
                    : "attempt 2",
            });
          }
          next[name] = { high, normal, low, completed, status: s.status, recent };
        }
        return next;
      });
      if (newLogs.length > 0) {
        setLogs((ls) => [...ls, ...newLogs].slice(-2000));
      }
    }, 450);
    return () => clearInterval(id);
  }, []);

  // trend of the focused queue's pending
  React.useEffect(() => {
    const id = setInterval(() => {
      const f = focusRef.current;
      setQueues((qs) => {
        if (f !== null) {
          const q = qs[f];
          if (q !== undefined) {
            setTrend((t) => [...t, pendingOf(q)].slice(-40));
          }
        }
        return qs;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const open = (node: Node | undefined) => {
    if (node === undefined) {
      return;
    }
    if (node.t === "g") {
      setPath((p) => [...p, node]);
      setSel(0);
    } else {
      setTrend([]);
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

  // suggestions only once there's something to match
  const suggestions =
    cmd === null || cmd.length === 0
      ? []
      : QUEUES.filter((name) =>
          displayName(name).toLowerCase().includes(cmd.toLowerCase()),
        ).slice(0, 6);

  // grid columns — needed here so up/down can move a whole row
  const avail = cols - 4;
  let perRow = Math.max(1, Math.floor(avail / 34));
  let cellWidth = Math.floor(avail / perRow) - 1;
  while (cellWidth > 46 && perRow < members.length) {
    perRow += 1;
    cellWidth = Math.floor(avail / perRow) - 1;
  }
  cellWidth = Math.max(16, cellWidth);

  // scroll geometry — keep the selected cell on screen
  const totalRows = Math.ceil(members.length / perRow);
  const gridH = Math.max(CELL_HEIGHT, rows - 6); // border2 + crumb1 + pad2 + footer1
  const visibleRows = Math.max(1, Math.floor(gridH / (CELL_HEIGHT + 1)));
  const maxScroll = Math.max(0, totalRows - visibleRows);
  const selRow = Math.floor(sel / perRow);
  const effScroll = Math.min(scroll, maxScroll);
  layoutRef.current = {
    perRow,
    cellWidth,
    focused,
    cmd,
    sel,
    scroll: effScroll,
    maxScroll,
  };

  // when the selected row moves out of view, scroll to bring it back
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

  // mouse: SGR tracking (like grid-app). Wheel moves the selection a row; click
  // selects a cell, click again on the selected one opens it.
  React.useEffect(() => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (stdin.isTTY !== true) {
      return;
    }
    stdout.write("\x1b[?1000h\x1b[?1006h");
    const GRID_TOP = 4; // border(1) + breadcrumb(1) + grid pad(1), 1-based first row
    const GRID_LEFT = 3; // border(1) + grid pad(1)
    const onData = (data: Buffer) => {
      const re = /\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m: RegExpExecArray | null;
      const text = data.toString("utf8");
      while ((m = re.exec(text)) !== null) {
        const button = Number(m[1]);
        const x = Number(m[2]);
        const y = Number(m[3]);
        const press = m[4] === "M";
        const v = layoutRef.current;
        if (button === 64) {
          setScroll((s) => Math.max(0, s - 1));
        } else if (button === 65) {
          setScroll((s) => Math.min(v.maxScroll, s + 1));
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
              setTrend([]);
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

  useInput((input, key) => {
    if (cmd !== null) {
      if (key.return) {
        const pick = suggestions[cmdSel] ?? suggestions[0];
        setCmd(null);
        if (pick !== undefined) {
          setTrend([]);
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
      return; // (resource controls would go here in edit mode)
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
      open(selectedNode);
    }
  });

  // ── focused: a queue full-screen, widget + log tail ──
  if (focused !== null) {
    const q = queues[focused];
    const view = q === undefined ? undefined : viewOf(focused, q, trend);
    const footerRows = cmd === null ? 1 : suggestions.length + 1;
    const visible = Math.max(1, rows - PAGE_HEIGHT - 4 - footerRows);
    const tail = logs.filter((e) => e.queue === focused).slice(-visible);
    const hint = (
      <Box paddingX={1} backgroundColor="gray">
        <Text dimColor> Esc back · </Text>
        <Text color="cyan">:</Text>
        <Text dimColor> command · </Text>
        <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT" : "view"}</Text>
        <Text dimColor> Ctrl+E</Text>
      </Box>
    );
    return (
      <Box flexDirection="column" width={cols} height={rows} borderStyle={editMode ? "double" : BLANK_BORDER} borderColor="red">
        {view !== undefined ? (
          <Box flexShrink={0}>
            <PageXL v={view} width={cols - 2} />
          </Box>
        ) : null}
        <Box paddingX={1}>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
          </Box>
          <Text dimColor>{tail.length} shown</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end" paddingX={1}>
          {tail.map((e) => (
            <Box key={e.id}>
              <Box width={11}>
                <Text dimColor>{timeStr(e.t)}</Text>
              </Box>
              <Box width={2}>
                <Text color={LOG[e.kind].color}>{LOG[e.kind].icon}</Text>
              </Box>
              <Box width={9}>
                <Text color={LOG[e.kind].color}>{LOG[e.kind].label}</Text>
              </Box>
              <Box width={7}>
                <Text>{e.key}</Text>
              </Box>
              <Box flexGrow={1}>
                <Text dimColor>{e.detail}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        <Bar cmd={cmd} suggestions={suggestions} cmdSel={cmdSel} hint={hint} />
      </Box>
    );
  }

  // ── grid: breadcrumb + members + command bar ──
  const crumb = path.map((g) => displayName(g.name)).join(" / ");
  const start = effScroll * perRow;
  const visibleCells = members.slice(start, start + visibleRows * perRow);
  const more = totalRows - (effScroll + visibleRows);

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
          <Cell key={`${node.t}-${node.name}`} node={node} queues={queues} width={cellWidth} selected={start + i === sel} />
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
render(<App />);
