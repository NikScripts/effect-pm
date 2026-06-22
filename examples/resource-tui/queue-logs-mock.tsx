/**
 * @module examples/resource-tui/queue-logs-mock
 *
 * Full-screen queue (the **XL widget**) pinned to the top, with a **live log tail
 * below it**. The widget is fixed height; the logs fill the rest and always show
 * the latest at the bottom (older lines scroll off the top). This is the shape the
 * real `.changes`/`.metrics` (widget) + `.events` (logs) streams would feed.
 *
 * Controls locked by default ([l] to unlock — red border warns you); resource
 * controls while unlocked: [p] pause [r] resume [c] clear [x] stop. Quit with Ctrl+C.
 *
 *   pnpm run example:queue-logs
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";

type Status = "running" | "paused" | "stopped";
type Priority = "high" | "normal" | "low";
type Kind = "started" | "completed" | "failed" | "retry";

const NAME = "mail-queue";
const COLOR: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  stopped: "red",
};
const STATUS_ICON: Record<Status, string> = {
  running: "►",
  paused: "‖",
  stopped: "■",
};
const SYM: Record<Priority, { symbol: string; color: string; label: string }> = {
  high: { symbol: "▲", color: "red", label: "high" },
  normal: { symbol: "•", color: "white", label: "normal" },
  low: { symbol: "▼", color: "blue", label: "low" },
};
const LOG: Record<Kind, { icon: string; color: string; label: string }> = {
  started: { icon: "►", color: "gray", label: "started" },
  completed: { icon: "✓", color: "green", label: "done" },
  failed: { icon: "✗", color: "red", label: "failed" },
  retry: { icon: "↻", color: "yellow", label: "retry" },
};
const SPARK = "▁▂▃▄▅▆▇█";
const BLANK_BORDER = {
  topLeft: " ",
  top: " ",
  topRight: " ",
  right: " ",
  bottomRight: " ",
  bottom: " ",
  bottomLeft: " ",
  left: " ",
};

let rngState = 0x51ed2701;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
let logId = 0;
const nextId = (): number => (logId += 1);
const hexKey = (): string =>
  Math.floor(rng() * 0xffff)
    .toString(16)
    .padStart(4, "0");
const timeStr = (t: number): string => new Date(t).toLocaleTimeString();
const fmt = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
};
const spark = (vals: ReadonlyArray<number>): string => {
  if (vals.length === 0) {
    return "";
  }
  const max = Math.max(...vals, 1);
  return vals
    .map((v) => SPARK[Math.min(7, Math.floor((v / max) * 7))] ?? " ")
    .join("");
};

interface QState {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
  readonly completed: number;
  readonly status: Status;
  readonly recent: ReadonlyArray<number>;
}
interface LogEntry {
  readonly id: number;
  readonly t: number;
  readonly kind: Kind;
  readonly key: string;
  readonly detail: string;
}

const initial = (): QState => ({
  high: 3,
  normal: 9,
  low: 2,
  completed: 248,
  status: "running",
  recent: [],
});

// mock metrics from counts (backlog-proportional wait; low priority waits longest)
const WAIT_FACTOR: Record<Priority, number> = { high: 350, normal: 700, low: 1600 };

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

const WIDGET_HEIGHT = 16;

const PrioRow = (props: {
  readonly p: Priority;
  readonly count: number;
  readonly max: number;
  readonly barWidth: number;
}): React.ReactElement => {
  const s = SYM[props.p];
  return (
    <Box>
      <Box width={8}>
        <Text>
          {s.symbol} {s.label}
        </Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(props.count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={3} justifyContent="flex-end">
        <Text>{props.count}</Text>
      </Box>
      <Box width={16} justifyContent="flex-end">
        <Text dimColor>wait ⌀ {fmt(props.count * WAIT_FACTOR[props.p])}</Text>
      </Box>
    </Box>
  );
};

const Widget = (props: {
  readonly q: QState;
  readonly trend: ReadonlyArray<number>;
  readonly width: number;
}): React.ReactElement => {
  const { q, trend, width } = props;
  const pending = q.high + q.normal + q.low;
  const max = Math.max(q.high, q.normal, q.low, 1);
  const throughput = q.recent.length / 5;
  const execution = 700 + (q.completed % 5) * 120;
  const overallWait =
    pending > 0
      ? (q.high * WAIT_FACTOR.high +
          q.normal * WAIT_FACTOR.normal +
          q.low * WAIT_FACTOR.low) /
        pending
      : 0;
  const total = overallWait + execution;
  const barWidth = Math.min(30, Math.max(8, width - 4 - 8 - 1 - 3 - 16));
  return (
    <Box
      flexShrink={0}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={2}
      paddingY={1}
      height={WIDGET_HEIGHT}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {NAME}
        </Text>
        <Text color={COLOR[q.status]}>
          {STATUS_ICON[q.status]} {q.status}
        </Text>
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text bold>PENDING {pending}</Text>
        <Text bold>COMPLETED {q.completed}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <PrioRow p="high" count={q.high} max={max} barWidth={barWidth} />
        <PrioRow p="normal" count={q.normal} max={max} barWidth={barWidth} />
        <PrioRow p="low" count={q.low} max={max} barWidth={barWidth} />
      </Box>
      <Box marginTop={1}>
        <Box width={22}>
          <Text>execution ⌀ {fmt(execution)}</Text>
        </Box>
        <Box width={20}>
          <Text>total ⌀ {fmt(total)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="green">{spark(trend)}</Text>
        <Text dimColor> pending · {trend.length}s</Text>
      </Box>
    </Box>
  );
};

const LogLine = (props: { readonly entry: LogEntry }): React.ReactElement => {
  const { entry } = props;
  const m = LOG[entry.kind];
  return (
    <Box>
      <Box width={11}>
        <Text dimColor>{timeStr(entry.t)}</Text>
      </Box>
      <Box width={2}>
        <Text color={m.color}>{m.icon}</Text>
      </Box>
      <Box width={9}>
        <Text color={m.color}>{m.label}</Text>
      </Box>
      <Box width={7}>
        <Text>{entry.key}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text dimColor>{entry.detail}</Text>
      </Box>
    </Box>
  );
};

const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const [locked, setLocked] = React.useState(true);
  const [q, setQ] = React.useState<QState>(initial);
  const [logs, setLogs] = React.useState<ReadonlyArray<LogEntry>>([]);
  const [trend, setTrend] = React.useState<ReadonlyArray<number>>([]);

  const qRef = React.useRef(q);
  qRef.current = q;
  const sizeRef = React.useRef(0);
  sizeRef.current = q.high + q.normal + q.low;

  // producer + worker + log emitter
  React.useEffect(() => {
    if (q.status !== "running") {
      return;
    }
    const id = setInterval(() => {
      const s = qRef.current;
      const now = Date.now();
      let { high, normal, low, completed } = s;
      let recent = s.recent;
      const emitted: Array<LogEntry> = [];
      if (rng() < 0.5) {
        const r = rng();
        if (r < 0.2) {
          high += 1;
        } else if (r < 0.8) {
          normal += 1;
        } else {
          low += 1;
        }
      }
      if (high + normal + low > 0) {
        if (high > 0) {
          high -= 1;
        } else if (normal > 0) {
          normal -= 1;
        } else {
          low -= 1;
        }
        const key = hexKey();
        const roll = rng();
        if (roll < 0.08) {
          emitted.push({ id: nextId(), t: now, kind: "failed", key, detail: "timeout" });
        } else if (roll < 0.14) {
          emitted.push({ id: nextId(), t: now, kind: "retry", key, detail: "attempt 2" });
        } else {
          completed += 1;
          recent = [...recent, now].filter((t) => now - t < 5000);
          emitted.push({
            id: nextId(),
            t: now,
            kind: "completed",
            key,
            detail: `${80 + Math.floor(rng() * 400)}ms`,
          });
        }
      }
      const next: QState = { high, normal, low, completed, status: s.status, recent };
      qRef.current = next;
      setQ(next);
      if (emitted.length > 0) {
        setLogs((ls) => [...ls, ...emitted].slice(-1000));
      }
    }, 450);
    return () => clearInterval(id);
  }, [q.status]);

  // pending trend sampler
  React.useEffect(() => {
    const id = setInterval(
      () => setTrend((t) => [...t, sizeRef.current].slice(-40)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  useInput((input) => {
    if (input === "l") {
      setLocked((x) => !x);
      return;
    }
    if (locked) {
      return;
    }
    if (input === "p") {
      setQ((s) => ({ ...s, status: "paused" }));
    } else if (input === "r" || input === "s") {
      setQ((s) => ({ ...s, status: "running" }));
    } else if (input === "c") {
      setQ((s) => ({ ...s, high: 0, normal: 0, low: 0 }));
    } else if (input === "x") {
      setQ((s) => ({ ...s, status: "stopped" }));
    }
  });

  // how many log lines fit below the widget
  const visibleLogs = Math.max(1, rows - WIDGET_HEIGHT - 7);
  const tail = logs.slice(-visibleLogs);

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={locked ? BLANK_BORDER : "double"}
      borderColor="red"
    >
      <Widget q={q} trend={trend} width={cols} />

      <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
          </Box>
          <Text dimColor>{logs.length} events</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          {tail.map((e) => (
            <LogLine key={e.id} entry={e} />
          ))}
        </Box>
      </Box>

      <Box paddingX={1} backgroundColor="gray">
        <Text color={locked ? "yellow" : "green"}>
          {locked ? "controls locked" : "controls unlocked"}
        </Text>
        <Text dimColor>
          {locked
            ? " · [l] unlock"
            : " · [l] lock · [p] pause [r] resume [c] clear [x] stop"}
        </Text>
      </Box>
    </Box>
  );
};

const out = process.stdout;
const tty = out.isTTY === true;
const restore = () => {
  if (tty) {
    out.write("\x1b[?1049l");
  }
};
if (tty) {
  out.write("\x1b[?1049h\x1b[2J\x1b[H");
}
process.on("exit", restore);
render(<App />);
