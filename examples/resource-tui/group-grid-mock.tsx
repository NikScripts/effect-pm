/**
 * @module examples/resource-tui/group-grid-mock
 *
 * Full-screen **group dashboard** mock — a responsive grid of (usefully large)
 * queue widgets that scales up to big terminals. A subgroup is its own widget that
 * packs XS member rows, collapsing to just the name when the cell is too small.
 *
 * Controls are **locked by default** (so stray keys can't touch resources). TUI
 * controls (lock toggle, resize) are separate from resource controls (pause/resume
 * the queues), and resource controls only fire while unlocked. Quit with Ctrl+C.
 *
 *   pnpm run example:group-grid
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";

type Status = "running" | "paused" | "stopped";
type Priority = "high" | "normal" | "low";
const COLOR: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  stopped: "red",
};
const ICON: Record<Status, string> = {
  running: "►",
  paused: "‖",
  stopped: "■",
};
const SYM: Record<Priority, { symbol: string; color: string; label: string }> = {
  high: { symbol: "▲", color: "red", label: "high" },
  normal: { symbol: "•", color: "white", label: "normal" },
  low: { symbol: "▼", color: "blue", label: "low" },
};

interface Q {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
  readonly completed: number;
  readonly status: Status;
}
type Node =
  | { readonly t: "q"; readonly name: string }
  | { readonly t: "g"; readonly name: string; readonly members: ReadonlyArray<Node> };

const TREE: Extract<Node, { t: "g" }> = {
  t: "g",
  name: "ops",
  members: [
    { t: "q", name: "mail" },
    { t: "q", name: "jobs" },
    { t: "q", name: "billing" },
    {
      t: "g",
      name: "workers",
      members: [
        { t: "q", name: "worker-1" },
        { t: "q", name: "worker-2" },
        { t: "q", name: "worker-3" },
      ],
    },
    { t: "q", name: "notify" },
    { t: "q", name: "exports" },
    {
      t: "g",
      name: "reports",
      members: [
        { t: "q", name: "daily" },
        { t: "q", name: "weekly" },
      ],
    },
  ],
};
const QUEUES = [
  "mail",
  "jobs",
  "billing",
  "worker-1",
  "worker-2",
  "worker-3",
  "notify",
  "exports",
  "daily",
  "weekly",
];

let rngState = 0x9e3779b1;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};

const initQueues = (): Record<string, Q> => {
  const r: Record<string, Q> = {};
  for (const name of QUEUES) {
    r[name] = {
      high: 1 + Math.floor(rng() * 5),
      normal: 3 + Math.floor(rng() * 14),
      low: Math.floor(rng() * 6),
      completed: 50 + Math.floor(rng() * 400),
      status: "running",
    };
  }
  return r;
};

const advance = (q: Q): Q => {
  let { high, normal, low } = q;
  let completed = q.completed;
  if (rng() < 0.55) {
    const r = rng();
    if (r < 0.2) {
      high += 1;
    } else if (r < 0.8) {
      normal += 1;
    } else {
      low += 1;
    }
  }
  if (q.status === "running" && high + normal + low > 0) {
    if (high > 0) {
      high -= 1;
    } else if (normal > 0) {
      normal -= 1;
    } else {
      low -= 1;
    }
    completed += 1;
  }
  return { high, normal, low, completed, status: q.status };
};

const pendingOf = (q: Q): number => q.high + q.normal + q.low;
const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
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
      <Box width={props.showLabel ? 8 : 2}>
        <Text>
          {s.symbol}
          {props.showLabel ? ` ${s.label}` : ""}
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

// ── one queue as a grid cell — sized to the cell, useful even when small ──
const QueueCard = (props: {
  readonly name: string;
  readonly q: Q;
  readonly width: number;
}): React.ReactElement => {
  const { name, q, width } = props;
  const pending = pendingOf(q);
  const max = Math.max(q.high, q.normal, q.low, 1);

  if (width < 24) {
    return (
      <Box borderStyle="round" borderColor={COLOR[q.status]} width={width} marginRight={1} marginBottom={1} paddingX={1}>
        <Box flexGrow={1}>
          <Text color={COLOR[q.status]}>{ICON[q.status]} </Text>
          <Text>{name}</Text>
        </Box>
        <Box width={4} justifyContent="flex-end">
          <Text>{pending}</Text>
        </Box>
      </Box>
    );
  }

  const wide = width >= 40;
  const barWidth = Math.max(4, width - (wide ? 8 : 2) - 4 - 3);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[q.status]} width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold>{name}</Text>
        </Box>
        <Text color={COLOR[q.status]}>{ICON[q.status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {pending}</Text>
        </Box>
        <Text dimColor>{q.completed} ✓</Text>
      </Box>
      <PrioRow p="high" count={q.high} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="normal" count={q.normal} max={max} barWidth={barWidth} showLabel={wide} />
      <PrioRow p="low" count={q.low} max={max} barWidth={barWidth} showLabel={wide} />
    </Box>
  );
};

const XSRow = (props: {
  readonly node: Node;
  readonly queues: Record<string, Q>;
}): React.ReactElement | null => {
  const { node, queues } = props;
  if (node.t === "g") {
    return (
      <Text dimColor>
        ▸ {node.name} · {node.members.length}
      </Text>
    );
  }
  const q = queues[node.name];
  if (q === undefined) {
    return null;
  }
  return (
    <Box>
      <Box width={2}>
        <Text color={COLOR[q.status]}>{ICON[q.status]}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text>{node.name}</Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text>{pendingOf(q)}</Text>
      </Box>
    </Box>
  );
};

const groupPending = (
  node: Extract<Node, { t: "g" }>,
  queues: Record<string, Q>,
): number =>
  node.members.reduce((sum, m) => {
    if (m.t === "g") {
      return sum + groupPending(m, queues);
    }
    const q = queues[m.name];
    return sum + (q === undefined ? 0 : pendingOf(q));
  }, 0);

const GroupCard = (props: {
  readonly node: Extract<Node, { t: "g" }>;
  readonly queues: Record<string, Q>;
  readonly width: number;
}): React.ReactElement => {
  const { node, queues, width } = props;
  const fits = width >= 22;
  const shown = node.members.slice(0, fits ? 6 : 0);
  const more = node.members.length - shown.length;
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="cyan" width={width} marginRight={1} marginBottom={1} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text bold color="cyan">
            {node.name} · {node.members.length}
          </Text>
        </Box>
        <Text dimColor>{groupPending(node, queues)} ⏳</Text>
      </Box>
      {shown.map((m, i) => (
        <XSRow key={`${node.name}-${i}`} node={m} queues={queues} />
      ))}
      {more > 0 ? <Text dimColor>+{more} more</Text> : null}
    </Box>
  );
};

const Cell = (props: {
  readonly node: Node;
  readonly queues: Record<string, Q>;
  readonly width: number;
}): React.ReactElement | null => {
  const { node, queues, width } = props;
  if (node.t === "g") {
    return <GroupCard node={node} queues={queues} width={width} />;
  }
  const q = queues[node.name];
  if (q === undefined) {
    return null;
  }
  return <QueueCard name={node.name} q={q} width={width} />;
};

const App = (): React.ReactElement => {
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

  const [queues, setQueues] = React.useState<Record<string, Q>>(initQueues);
  const [locked, setLocked] = React.useState(true);

  React.useEffect(() => {
    const id = setInterval(() => {
      setQueues((qs) => {
        const next: Record<string, Q> = { ...qs };
        for (const name of QUEUES) {
          const cur = next[name];
          if (cur !== undefined) {
            next[name] = advance(cur);
          }
        }
        return next;
      });
    }, 600);
    return () => clearInterval(id);
  }, []);

  const setAll = (status: Status) =>
    setQueues((qs) => {
      const next: Record<string, Q> = {};
      for (const name of QUEUES) {
        const cur = qs[name];
        if (cur !== undefined) {
          next[name] = { ...cur, status };
        }
      }
      return next;
    });

  useInput((input) => {
    // TUI controls — always available, separate from resource controls
    if (input === "l") {
      setLocked((x) => !x);
      return;
    }
    // resource controls — gated by the lock (Ctrl+C quits)
    if (locked) {
      return;
    }
    if (input === "p") {
      setAll("paused");
    } else if (input === "r" || input === "s") {
      setAll("running");
    }
  });

  const { cols, rows } = size;
  // target ~40-wide cells so widgets stay useful; scales out on big screens
  const perRow = Math.max(1, Math.floor((cols - 2) / 40));
  const cellWidth = Math.max(16, Math.floor((cols - 2) / perRow) - 1);

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={locked ? undefined : "double"}
      borderColor="red"
    >
      <Box paddingX={1}>
        <Text bold color="black" backgroundColor="cyan">
          {` ⬢ ${TREE.name} `}
        </Text>
        <Text dimColor>
          {" "}
          {QUEUES.length} queues · {TREE.members.length} top-level · {perRow}/row
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
        {TREE.members.map((node, i) => (
          <Cell key={`${node.t}-${node.name}-${i}`} node={node} queues={queues} width={cellWidth} />
        ))}
      </Box>

      <Box paddingX={1} backgroundColor="gray">
        <Text dimColor>{` ${cols}×${rows} · resize reflows · `}</Text>
        <Text color={locked ? "yellow" : "green"}>
          {locked ? "controls locked" : "controls unlocked"}
        </Text>
        <Text dimColor>
          {locked
            ? " · [l] unlock"
            : " · [l] lock · [p]‖ pause all · [r]► resume"}
        </Text>
      </Box>
    </Box>
  );
};

const out = process.stdout;
const tty = out.isTTY === true;
if (tty) {
  out.write("\x1b[?1049h\x1b[2J\x1b[H");
}
const restore = () => {
  if (tty) {
    out.write("\x1b[?1049l");
  }
};
const app = render(<App />);
void app.waitUntilExit().finally(restore);
process.on("exit", restore);
