/**
 * @module examples/resource-tui/queue-mock
 *
 * A **responsive, interactive mock** of the queue widget — S / M / L cards and an
 * XL full page, switched live by terminal size (resize your window to see it step).
 * Data is hardcoded but honest to `QueueHandleApi`: pending `sizes` (high/normal/low),
 * total pending, `completed`, `isEmpty`. Status is UI-tracked (the real handle can't
 * read run-state today).
 *
 * Interactive: [a] add · [h] high · [l] low · [p] pause · [r] resume · [c] clear ·
 * [x] shutdown · [q] quit. While running, a worker processes one item every ~800ms.
 *
 *   pnpm run example:queue-mock
 */

import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import * as React from "react";

type Status = "running" | "paused" | "stopped";

interface QState {
  readonly high: number;
  readonly normal: number;
  readonly low: number;
  readonly completed: number;
  readonly status: Status;
}

const NAME = "mail-queue";
const COLOR: Record<Status, string> = {
  running: "green",
  paused: "yellow",
  stopped: "red",
};

const bar = (value: number, max: number, width: number): string => {
  const filled = max <= 0 ? 0 : Math.min(width, Math.round((value / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
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

const variantFor = (cols: number, rows: number): "S" | "M" | "L" | "XL" => {
  if (cols >= 78 && rows >= 18) {
    return "XL";
  }
  if (cols >= 48) {
    return "L";
  }
  if (cols >= 34) {
    return "M";
  }
  return "S";
};

const Dot = (props: { readonly status: Status }): React.ReactElement => (
  <Text color={COLOR[props.status]}>● {props.status}</Text>
);

const Row = (props: {
  readonly symbol: string;
  readonly color: string;
  readonly label?: string;
  readonly value: number;
  readonly max: number;
  readonly barWidth: number;
}): React.ReactElement => (
  <Text>
    {props.symbol}
    {props.label !== undefined ? ` ${props.label.padEnd(7)}` : " "}
    <Text color={props.color}>{bar(props.value, props.max, props.barWidth)}</Text>{" "}
    {props.value}
  </Text>
);

const totals = (q: QState) => ({
  pending: q.high + q.normal + q.low,
  max: Math.max(q.high, q.normal, q.low, 1),
});

const CardS = (props: { readonly q: QState }): React.ReactElement => {
  const { q } = props;
  const { pending } = totals(q);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={1}
      width={24}
    >
      <Text bold>{NAME}</Text>
      <Text>
        {pending} ⏳ {"   "}
        {q.completed} ✓
      </Text>
      <Text>
        ▲{q.high} •{q.normal} ▼{q.low} <Dot status={q.status} />
      </Text>
    </Box>
  );
};

const CardM = (props: { readonly q: QState }): React.ReactElement => {
  const { q } = props;
  const { pending, max } = totals(q);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={1}
      width={32}
    >
      <Box justifyContent="space-between">
        <Text bold>{NAME}</Text>
        <Dot status={q.status} />
      </Box>
      <Text>pending {pending}</Text>
      <Row symbol="▲" color="red" value={q.high} max={max} barWidth={5} />
      <Row symbol="•" color="white" value={q.normal} max={max} barWidth={5} />
      <Row symbol="▼" color="blue" value={q.low} max={max} barWidth={5} />
      <Text dimColor>✓ {q.completed} done</Text>
    </Box>
  );
};

const CardL = (props: { readonly q: QState }): React.ReactElement => {
  const { q } = props;
  const { pending, max } = totals(q);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={1}
      width={40}
    >
      <Box justifyContent="space-between">
        <Text bold>{NAME}</Text>
        <Dot status={q.status} />
      </Box>
      <Box justifyContent="space-between">
        <Text>PENDING {pending}</Text>
        <Text>COMPLETED {q.completed}</Text>
      </Box>
      <Row symbol="▲" color="red" label="high" value={q.high} max={max} barWidth={10} />
      <Row symbol="•" color="white" label="normal" value={q.normal} max={max} barWidth={10} />
      <Row symbol="▼" color="blue" label="low" value={q.low} max={max} barWidth={10} />
      <Text dimColor>empty: {pending === 0 ? "yes" : "no"}</Text>
      <Text dimColor>a·add p·pause c·clear</Text>
    </Box>
  );
};

const PageXL = (props: {
  readonly q: QState;
  readonly cols: number;
}): React.ReactElement => {
  const { q, cols } = props;
  const { pending, max } = totals(q);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[q.status]}
      paddingX={2}
      paddingY={1}
      width={Math.min(cols - 4, 72)}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {NAME}
        </Text>
        <Dot status={q.status} />
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text bold>PENDING {pending}</Text>
        <Text bold>COMPLETED {q.completed}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Row symbol="▲" color="red" label="high" value={q.high} max={max} barWidth={20} />
        <Row symbol="•" color="white" label="normal" value={q.normal} max={max} barWidth={20} />
        <Row symbol="▼" color="blue" label="low" value={q.low} max={max} barWidth={20} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>empty: {pending === 0 ? "yes" : "no"}</Text>
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
  const variant = variantFor(cols, rows);
  const [q, setQ] = React.useState<QState>({
    high: 3,
    normal: 7,
    low: 2,
    completed: 248,
    status: "running",
  });

  // a worker processes one item (highest priority first) while running
  React.useEffect(() => {
    if (q.status !== "running") {
      return;
    }
    const id = setInterval(() => {
      setQ((s) => {
        if (s.high > 0) {
          return { ...s, high: s.high - 1, completed: s.completed + 1 };
        }
        if (s.normal > 0) {
          return { ...s, normal: s.normal - 1, completed: s.completed + 1 };
        }
        if (s.low > 0) {
          return { ...s, low: s.low - 1, completed: s.completed + 1 };
        }
        return s;
      });
    }, 800);
    return () => clearInterval(id);
  }, [q.status]);

  useInput((input) => {
    if (input === "a") {
      setQ((s) => ({ ...s, normal: s.normal + 1 }));
    } else if (input === "h") {
      setQ((s) => ({ ...s, high: s.high + 1 }));
    } else if (input === "l") {
      setQ((s) => ({ ...s, low: s.low + 1 }));
    } else if (input === "p") {
      setQ((s) => ({ ...s, status: "paused" }));
    } else if (input === "r" || input === "s") {
      setQ((s) => ({ ...s, status: "running" }));
    } else if (input === "c") {
      setQ((s) => ({ ...s, high: 0, normal: 0, low: 0, completed: 0 }));
    } else if (input === "x") {
      setQ((s) => ({ ...s, status: "stopped" }));
    } else if (input === "q") {
      exit();
    }
  });

  const widget =
    variant === "XL" ? (
      <PageXL q={q} cols={cols} />
    ) : variant === "L" ? (
      <CardL q={q} />
    ) : variant === "M" ? (
      <CardM q={q} />
    ) : (
      <CardS q={q} />
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
          {` ${cols}×${rows} · resize to change size · [a/h/l] enqueue · [p/r] pause/resume · [c] clear · [q] quit`}
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
