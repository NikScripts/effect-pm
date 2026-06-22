/**
 * @module examples/resource-tui/queue-logs-mock
 *
 * Full-screen queue with a **live log tail below it**. The widget is pinned to the
 * top (fixed height); the logs fill the rest and always show the **latest at the
 * bottom** (older lines scroll off the top). This is the shape the real `.events`
 * stream would feed.
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
const SYM: Record<Priority, { symbol: string; color: string }> = {
  high: { symbol: "▲", color: "red" },
  normal: { symbol: "•", color: "white" },
  low: { symbol: "▼", color: "blue" },
};
const LOG: Record<Kind, { icon: string; color: string; label: string }> = {
  started: { icon: "►", color: "gray", label: "started" },
  completed: { icon: "✓", color: "green", label: "done" },
  failed: { icon: "✗", color: "red", label: "failed" },
  retry: { icon: "↻", color: "yellow", label: "retry" },
};
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
const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
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

const WIDGET_HEIGHT = 8;

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
      <Box width={4} justifyContent="flex-end">
        <Text>{props.count}</Text>
      </Box>
    </Box>
  );
};

const Widget = (props: {
  readonly q: QState;
  readonly width: number;
}): React.ReactElement => {
  const { q, width } = props;
  const pending = q.high + q.normal + q.low;
  const max = Math.max(q.high, q.normal, q.low, 1);
  const throughput = q.recent.length / 5;
  const barWidth = Math.min(28, Math.max(4, width - 6 - 2 - 1 - 4));
  return (
    <Box
      flexShrink={0}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={1}
      height={WIDGET_HEIGHT}
    >
      <Box>
        <Box flexGrow={1}>
          <Text bold color="cyan">
            {NAME}
          </Text>
        </Box>
        <Text color={COLOR[q.status]}>
          {STATUS_ICON[q.status]} {q.status}
        </Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {pending}</Text>
        </Box>
        <Text dimColor>
          completed {q.completed} · {throughput.toFixed(1)}/s
        </Text>
      </Box>
      <PrioRow p="high" count={q.high} max={max} barWidth={barWidth} />
      <PrioRow p="normal" count={q.normal} max={max} barWidth={barWidth} />
      <PrioRow p="low" count={q.low} max={max} barWidth={barWidth} />
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

  const qRef = React.useRef(q);
  qRef.current = q;

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

  // how many log lines fit: rows − root border(2) − widget − logs border(2) −
  // logs header(1) − footer(1) − safety(1)
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
      <Widget q={q} width={cols} />

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
