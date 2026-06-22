/**
 * @module examples/resource-tui/queue-mock
 *
 * Responsive, interactive queue mock — S / M / L cards + XL full page, enriched
 * with the planned streams' data:
 *   .changes  → status + sizes {high, normal, low}
 *   .metrics  → avg WAIT per priority, avg EXECUTION (overall), TOTAL, throughput
 * (execution isn't sliced by priority — priority only affects wait, not run time.)
 *
 * Items arrive on their own (a producer, ~700ms, priority mix) — even while paused,
 * so the queue backs up when you stop draining. A worker drains one item (~500ms),
 * highest priority first, while running.
 *
 * Pick a size to view it full-screen: [1] S  [2] M  [3] L  [4] XL  [0] auto (resize).
 * Controls (the real lifecycle ones): [p] pause [r] resume [c] clear [x] stop ·
 * [b] burst (a producer surge) · [q] quit.
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
const STATUS_ICON: Record<Status, string> = {
  running: "▶",
  paused: "⏸",
  stopped: "⏹",
};
// key → icon (media-style; ⚡ for a producer burst, ⎋ for quit)
const KEY = {
  pause: "⏸",
  resume: "▶",
  clear: "⌫",
  stop: "⏹",
  burst: "⚡",
  quit: "⎋",
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

// deterministic pseudo-random (avoids Math.random) for the producer
let rngState = 0x2f6e2b1;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
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
  <Text color={COLOR[props.status]}>
    {STATUS_ICON[props.status]} {props.status}
  </Text>
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

const PrioRow = (props: {
  readonly p: Priority;
  readonly v: View;
  readonly barWidth: number;
  readonly max: number;
  readonly labelWidth: number;
  readonly showLabel: boolean;
  readonly waitWidth: number; // 0 hides the wait column
  readonly waitPrefix?: string;
}): React.ReactElement => {
  const s = SYM[props.p];
  const count = props.v.sizes[props.p];
  return (
    <Box>
      <Box width={props.labelWidth}>
        <Text>
          {s.symbol}
          {props.showLabel ? ` ${s.label}` : ""}
        </Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={3} justifyContent="flex-end">
        <Text>{count}</Text>
      </Box>
      {props.waitWidth > 0 ? (
        <Box width={props.waitWidth} justifyContent="flex-end">
          <Text dimColor>
            {props.waitPrefix ?? ""}⌀ {fmt(props.v.wait[props.p])}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

const CardS = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={26}>
      <Title status={v.status} />
      <Box>
        <Box width={12}>
          <Text>{v.pending} pending</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.completed} ✓</Text>
        </Box>
      </Box>
      <Box>
        <Box width={12}>
          <Text>
            ▲{v.sizes.high} •{v.sizes.normal} ▼{v.sizes.low}
          </Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
    </Box>
  );
};

const CardM = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={34}>
      <Title status={v.status} />
      <Box>
        <Box width={14}>
          <Text>pending {v.pending}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <PrioRow p="high" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <PrioRow p="normal" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <PrioRow p="low" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <Box>
        <Box width={14}>
          <Text dimColor>exec ⌀ {fmt(v.execution)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor>✓ {v.completed}</Text>
        </Box>
      </Box>
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
      <PrioRow p="high" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <PrioRow p="normal" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <PrioRow p="low" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <Box marginTop={1}>
        <Box width={15}>
          <Text dimColor>exec ⌀ {fmt(v.execution)}</Text>
        </Box>
        <Box width={15}>
          <Text dimColor>total ⌀ {fmt(v.total)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <Text dimColor>
        [p]{KEY.pause} [c]{KEY.clear} [b]{KEY.burst}
      </Text>
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
        <PrioRow p="high" v={v} barWidth={20} max={max} labelWidth={8} showLabel waitWidth={16} waitPrefix="wait " />
        <PrioRow p="normal" v={v} barWidth={20} max={max} labelWidth={8} showLabel waitWidth={16} waitPrefix="wait " />
        <PrioRow p="low" v={v} barWidth={20} max={max} labelWidth={8} showLabel waitWidth={16} waitPrefix="wait " />
      </Box>
      <Box marginTop={1}>
        <Box width={22}>
          <Text>execution ⌀ {fmt(v.execution)}</Text>
        </Box>
        <Box width={22}>
          <Text>total ⌀ {fmt(v.total)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="green">{spark(v.trend)}</Text>
        <Text dimColor> pending · last {v.trend.length}s</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [p]{KEY.pause} [r]{KEY.resume} [c]{KEY.clear} [x]{KEY.stop} {"  "} [b]{KEY.burst} {"  "} [q]{KEY.quit}
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

  // producer: items arrive over time (a priority mix), even while paused so the
  // queue backs up when you stop draining
  React.useEffect(() => {
    if (q.status === "stopped") {
      return;
    }
    const id = setInterval(() => {
      setQ((s) => {
        const now = Date.now();
        const count = 1 + Math.floor(rng() * 2);
        let high = s.high;
        let normal = s.normal;
        let low = s.low;
        for (let i = 0; i < count; i++) {
          const r = rng();
          const item = { at: now };
          if (r < 0.18) {
            high = [...high, item];
          } else if (r < 0.82) {
            normal = [...normal, item];
          } else {
            low = [...low, item];
          }
        }
        return { ...s, high, normal, low };
      });
    }, 700);
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

  useInput((input) => {
    if (input === "b") {
      // burst: simulate a producer surge
      setQ((s) => ({
        ...s,
        normal: [
          ...s.normal,
          ...Array.from({ length: 10 }, () => ({ at: Date.now() })),
        ],
      }));
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
          {` ${lock === "auto" ? "auto" : "locked"} · ${cols}×${rows} · [1-4] size [0] auto · [p]${KEY.pause} [r]${KEY.resume} [c]${KEY.clear} [x]${KEY.stop} [b]${KEY.burst} [q]${KEY.quit}`}
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
