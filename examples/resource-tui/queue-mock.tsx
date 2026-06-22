/**
 * @module examples/resource-tui/queue-mock
 *
 * Responsive, interactive queue mock — S / M / L cards + XL full page, enriched
 * with the planned streams' data:
 *   .changes  → status + sizes {high, normal, low}
 *   .metrics  → avg WAIT per priority, avg EXECUTION (overall), TOTAL, throughput
 * (execution isn't sliced by priority — priority only affects wait, not run time.)
 *
 * Pick a size to view it full-screen: [1] S  [2] M  [3] L  [4] XL  [0] auto (resize).
 * Controls: [a] add [h] high [l] low · [p] pause [r] resume [c] clear [x] stop · [q] quit.
 * While running a worker drains one item (~500ms), highest priority first.
 *
 *   pnpm run example:queue-mock
 */

import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import * as React from "react";

type Status = "running" | "paused" | "stopped";
type Priority = "high" | "normal" | "low";
type Variant = "S" | "M" | "L" | "XL";

interface Item {
  readonly at: number;
}
interface QState {
  readonly high: ReadonlyArray<Item>;
  readonly normal: ReadonlyArray<Item>;
  readonly low: ReadonlyArray<Item>;
  readonly completed: number;
  readonly status: Status;
  readonly wait: Record<Priority, number>; // EWMA, ms
  readonly waitOverall: number; // EWMA, ms
  readonly execution: number; // EWMA, ms
  readonly recent: ReadonlyArray<number>; // completion timestamps (last 5s)
}

const NAME = "mail-queue";
const COLOR: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  stopped: "red",
};
const SPARK = "▁▂▃▄▅▆▇█";

const ewma = (old: number, v: number): number =>
  old <= 0 ? v : old * 0.8 + v * 0.2;
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

const seed = (n: number, ageMs: number, now: number): Array<Item> =>
  Array.from({ length: n }, (_, i) => ({ at: now - ageMs - i * 200 }));

const initial = (): QState => {
  const now = Date.now();
  return {
    high: seed(3, 400, now),
    normal: seed(7, 2000, now),
    low: seed(2, 8000, now),
    completed: 248,
    status: "running",
    wait: { high: 400, normal: 2100, low: 8700 },
    waitOverall: 1800,
    execution: 850,
    recent: [],
  };
};

// ── derived view passed to the variants ──
interface View {
  readonly status: Status;
  readonly sizes: Record<Priority, number>;
  readonly pending: number;
  readonly completed: number;
  readonly wait: Record<Priority, number>; // ms
  readonly execution: number; // ms
  readonly total: number; // ms
  readonly throughput: number; // per second
  readonly trend: ReadonlyArray<number>;
}

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

const variantFor = (cols: number, rows: number): Variant =>
  cols >= 78 && rows >= 18 ? "XL" : cols >= 48 ? "L" : cols >= 34 ? "M" : "S";

const Dot = (props: { readonly status: Status }): React.ReactElement => (
  <Text color={COLOR[props.status]}>● {props.status}</Text>
);

const Title = (props: { readonly status: Status }): React.ReactElement => (
  <Box justifyContent="space-between">
    <Text bold color="cyan">
      {NAME}
    </Text>
    <Dot status={props.status} />
  </Box>
);

const SYM: Record<Priority, { symbol: string; color: string; label: string }> = {
  high: { symbol: "▲", color: "red", label: "high" },
  normal: { symbol: "•", color: "white", label: "normal" },
  low: { symbol: "▼", color: "blue", label: "low" },
};

const PrioBar = (props: {
  readonly p: Priority;
  readonly v: View;
  readonly barWidth: number;
  readonly max: number;
  readonly label?: boolean;
  readonly wait?: "short" | "long";
}): React.ReactElement => {
  const s = SYM[props.p];
  const count = props.v.sizes[props.p];
  return (
    <Text>
      {s.symbol}
      {props.label === true ? ` ${s.label.padEnd(6)}` : " "}
      <Text color={s.color}>{bar(count, props.max, props.barWidth)}</Text> {count}
      {props.wait === undefined ? null : (
        <Text dimColor>
          {props.wait === "long" ? "   wait ⌀ " : "   ⌀ "}
          {fmt(props.v.wait[props.p])}
        </Text>
      )}
    </Text>
  );
};

const CardS = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={26}>
      <Title status={v.status} />
      <Text>
        {v.pending} ⏳ {"   "}
        {v.completed} ✓
      </Text>
      <Text>
        ▲{v.sizes.high} •{v.sizes.normal} ▼{v.sizes.low} {"  "}
        {v.throughput.toFixed(1)}/s
      </Text>
    </Box>
  );
};

const CardM = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={34}>
      <Title status={v.status} />
      <Text>
        pending {v.pending} {"   "}
        {v.throughput.toFixed(1)}/s
      </Text>
      <PrioBar p="high" v={v} barWidth={4} max={max} wait="short" />
      <PrioBar p="normal" v={v} barWidth={4} max={max} wait="short" />
      <PrioBar p="low" v={v} barWidth={4} max={max} wait="short" />
      <Text dimColor>
        exec ⌀ {fmt(v.execution)} {"  "} ✓ {v.completed}
      </Text>
    </Box>
  );
};

const CardL = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={44}>
      <Title status={v.status} />
      <Box justifyContent="space-between">
        <Text>PENDING {v.pending}</Text>
        <Text>COMPLETED {v.completed}</Text>
      </Box>
      <PrioBar p="high" v={v} barWidth={6} max={max} label wait="long" />
      <PrioBar p="normal" v={v} barWidth={6} max={max} label wait="long" />
      <PrioBar p="low" v={v} barWidth={6} max={max} label wait="long" />
      <Box justifyContent="space-between">
        <Text dimColor>exec ⌀ {fmt(v.execution)}</Text>
        <Text dimColor>total ⌀ {fmt(v.total)}</Text>
        <Text dimColor>{v.throughput.toFixed(1)}/s</Text>
      </Box>
      <Text dimColor>a·add p·pause c·clear</Text>
    </Box>
  );
};

const PageXL = (props: {
  readonly v: View;
  readonly cols: number;
}): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[v.status]}
      paddingX={2}
      paddingY={1}
      width={Math.min(props.cols - 4, 74)}
    >
      <Title status={v.status} />
      <Box marginTop={1} justifyContent="space-between">
        <Text bold>PENDING {v.pending}</Text>
        <Text bold>COMPLETED {v.completed}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <PrioBar p="high" v={v} barWidth={18} max={max} label wait="long" />
        <PrioBar p="normal" v={v} barWidth={18} max={max} label wait="long" />
        <PrioBar p="low" v={v} barWidth={18} max={max} label wait="long" />
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text>execution ⌀ {fmt(v.execution)}</Text>
        <Text>total ⌀ {fmt(v.total)}</Text>
        <Text>{v.throughput.toFixed(1)}/s</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="green">{spark(v.trend)}</Text>
        <Text dimColor> pending · last {v.trend.length}s</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [a]dd [h]igh [l]ow {"  "} [p]ause [r]esume [c]lear [x]shutdown {"  "} [q]uit
        </Text>
      </Box>
    </Box>
  );
};

const App = (): React.ReactElement => {
  const { exit } = useApp();
  const { cols, rows } = useTerminalSize();
  const [lock, setLock] = React.useState<"auto" | Variant>("auto");
  const variant = lock === "auto" ? variantFor(cols, rows) : lock;

  const [q, setQ] = React.useState<QState>(initial);
  const [trend, setTrend] = React.useState<ReadonlyArray<number>>([]);

  const sizeRef = React.useRef(0);
  sizeRef.current = q.high.length + q.normal.length + q.low.length;

  // worker: drain one item (highest priority first) while running
  React.useEffect(() => {
    if (q.status !== "running") {
      return;
    }
    const id = setInterval(() => {
      setQ((s) => {
        const now = Date.now();
        const pick: Priority | undefined =
          s.high.length > 0 ? "high" : s.normal.length > 0 ? "normal" : s.low.length > 0 ? "low" : undefined;
        if (pick === undefined) {
          return s;
        }
        const arr = s[pick];
        const item = arr[0];
        if (item === undefined) {
          return s;
        }
        const rest = arr.slice(1);
        const waitMs = now - item.at;
        const execMs = 700 + (s.completed % 5) * 120;
        return {
          ...s,
          high: pick === "high" ? rest : s.high,
          normal: pick === "normal" ? rest : s.normal,
          low: pick === "low" ? rest : s.low,
          completed: s.completed + 1,
          wait: { ...s.wait, [pick]: ewma(s.wait[pick], waitMs) },
          waitOverall: ewma(s.waitOverall, waitMs),
          execution: ewma(s.execution, execMs),
          recent: [...s.recent, now].filter((t) => now - t < 5000),
        };
      });
    }, 500);
    return () => clearInterval(id);
  }, [q.status]);

  // throughput/pending trend sampler
  React.useEffect(() => {
    const id = setInterval(
      () => setTrend((t) => [...t, sizeRef.current].slice(-30)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const enqueue = (p: Priority) =>
    setQ((s) => ({ ...s, [p]: [...s[p], { at: Date.now() }] }));

  useInput((input) => {
    if (input === "a") {
      enqueue("normal");
    } else if (input === "h") {
      enqueue("high");
    } else if (input === "l") {
      enqueue("low");
    } else if (input === "p") {
      setQ((s) => ({ ...s, status: "paused" }));
    } else if (input === "r" || input === "s") {
      setQ((s) => ({ ...s, status: "running" }));
    } else if (input === "c") {
      setQ((s) => ({ ...s, high: [], normal: [], low: [], completed: 0 }));
    } else if (input === "x") {
      setQ((s) => ({ ...s, status: "stopped" }));
    } else if (input === "1") {
      setLock("S");
    } else if (input === "2") {
      setLock("M");
    } else if (input === "3") {
      setLock("L");
    } else if (input === "4") {
      setLock("XL");
    } else if (input === "0") {
      setLock("auto");
    } else if (input === "q") {
      exit();
    }
  });

  const v: View = {
    status: q.status,
    sizes: { high: q.high.length, normal: q.normal.length, low: q.low.length },
    pending: q.high.length + q.normal.length + q.low.length,
    completed: q.completed,
    wait: q.wait,
    execution: q.execution,
    total: q.waitOverall + q.execution,
    throughput: q.recent.length / 5,
    trend,
  };

  const widget =
    variant === "XL" ? (
      <PageXL v={v} cols={cols} />
    ) : variant === "L" ? (
      <CardL v={v} />
    ) : variant === "M" ? (
      <CardM v={v} />
    ) : (
      <CardS v={v} />
    );

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        {widget}
      </Box>
      <Box paddingX={1} backgroundColor="gray">
        <Text color="black" backgroundColor="cyan">
          {` ${variant} `}
        </Text>
        <Text dimColor>
          {` ${lock === "auto" ? "auto" : "locked"} · ${cols}×${rows} · [1]S [2]M [3]L [4]XL [0]auto · a/h/l p/r c x · [q]uit`}
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
