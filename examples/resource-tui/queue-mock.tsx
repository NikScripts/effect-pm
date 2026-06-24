/**
 * @module examples/resource-tui/queue-mock
 *
 * Responsive, interactive queue mock — S / M / L cards + the XL full page (from the
 * shared `./queue-widget`), enriched with the planned streams' data:
 *   .changes  → status + sizes {high, normal, low}
 *   .metrics  → avg WAIT per priority, avg EXECUTION (overall), TOTAL, throughput
 *
 * Items arrive on their own (a producer, ~700ms) — even while paused, so the queue
 * backs up when you stop draining. A worker drains one item (~500ms), highest
 * priority first, while running.
 *
 * TUI controls (always): pick a size [1] S [2] M [3] L [4] XL [0] auto.
 * Resource controls are locked by default — Ctrl+E for edit mode (a red border warns
 * you): [p] pause [r] resume [c] clear [x] stop · [b] burst. Quit with Ctrl+C.
 *
 *   pnpm run example:queue-mock
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import {
  BLANK_BORDER,
  QueueWidget,
  type Priority,
  type Status,
  type Variant,
  type View,
  variantFor,
} from "./queue-widget";

const NAME = "@acme/queues/MailQueue";
const KEY = {
  pause: "‖",
  resume: "►",
  clear: "⊗",
  stop: "■",
  burst: "↯",
};

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

const ewma = (old: number, v: number): number =>
  old <= 0 ? v : old * 0.8 + v * 0.2;

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

const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const [lock, setLock] = React.useState<"auto" | Variant>("auto");
  const [locked, setLocked] = React.useState(true); // resource controls locked by default
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

  // producer: items arrive over time (a priority mix), even while paused
  React.useEffect(() => {
    if (q.status === "off") {
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

  // pending trend sampler
  React.useEffect(() => {
    const id = setInterval(
      () => setTrend((t) => [...t, sizeRef.current].slice(-30)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  useInput((input, key) => {
    // TUI controls — always available (separate from resource controls)
    if (key.ctrl && input === "e") {
      setLocked((x) => !x);
      return;
    }
    if (input === "1") {
      setLock("S");
      return;
    } else if (input === "2") {
      setLock("M");
      return;
    } else if (input === "3") {
      setLock("L");
      return;
    } else if (input === "4") {
      setLock("XL");
      return;
    } else if (input === "0") {
      setLock("auto");
      return;
    }
    // resource controls — only while unlocked (Ctrl+C quits)
    if (locked) {
      return;
    }
    if (input === "b") {
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
      setQ((s) => ({ ...s, status: "off" }));
    }
  });

  const v: View = {
    name: NAME,
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

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={locked ? BLANK_BORDER : "double"}
      borderColor="red"
    >
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <QueueWidget view={v} variant={variant} cols={cols} />
      </Box>
      <Box paddingX={1} backgroundColor="gray">
        <Text color="black" backgroundColor="cyan">
          {` ${variant} `}
        </Text>
        <Text dimColor>{` ${lock === "auto" ? "auto" : "fixed"} · ${cols}×${rows} · [1-4] size [0] auto · `}</Text>
        <Text color={locked ? "gray" : "red"}>
          {locked ? "view" : "EDIT MODE"}
        </Text>
        <Text dimColor>
          {locked
            ? ` · Ctrl+E edit`
            : ` · Ctrl+E exit · [p]${KEY.pause} [r]${KEY.resume} [c]${KEY.clear} [x]${KEY.stop} [b]${KEY.burst}`}
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
