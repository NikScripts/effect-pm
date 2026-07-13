/**
 * @module examples/resource-tui/queue-live
 *
 * The queue widget driven by a **real toolkit `QueueResource`** — no mock. A real
 * local queue (worker + producer) feeds the shared `PageXL` from its live `status`
 * and `metrics` streams; the log tail comes from {@link Resource.logs}.
 *
 * `Atom.runtime(layer)` is the seam: this is `QueueResource.layer` (local) today;
 * swapping in `Resource.client(tag)` (remote) changes nothing else.
 *
 * Ctrl+E enters edit mode (red border) for [p] pause [r] resume [c] clear
 * [x] shutdown. Quit with Ctrl+C.
 *
 *   pnpm run example:queue-live
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import { Data, Duration, Effect, Layer, Schema, Stream } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { QueueResource } from "../../src";
import * as LogEntry from "../../src/LogEntry";
import * as Logs from "../../src/Logs";
import * as ProcessStorage from "../../src/ProcessStorage";
import * as Resource from "../../src/Resource";
import { RegistryProvider, useAtomSet, useAtomValue } from "../../src/ui/atom-react";
import {
  BLANK_BORDER,
  PageXL,
  PAGE_HEIGHT,
  type Priority,
  type Status,
  type View,
} from "./queue-widget";

// ── a real queue ────────────────────────────────────────────────────────────
const NAME = "@acme/queues/MailQueue";
const Job = Schema.Struct({ id: Schema.String });
class MailQueue extends QueueResource.Tag<MailQueue>()(NAME, { payload: Job }) {}

class WorkerError extends Data.TaggedError("WorkerError")<{
  readonly id: string;
}> {}

let rngState = 0x51ed2701;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
let evId = 0;
const hexKey = (): string =>
  Math.floor(rng() * 0xffff)
    .toString(16)
    .padStart(4, "0");
const timeStr = (t: number): string => new Date(t).toLocaleTimeString();

// worker: variable execution, occasional failure, logging each step. Logs.layer +
// Resource.logs surfaces those lines on the live log tail (filter relay by resource key).
class TuiNode extends Resource.Node<TuiNode>("acme/tui") {}
const QueueLayer = QueueResource.layer(MailQueue, {
  effect: (job: { readonly id: string }) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing ${job.id}`);
      yield* Effect.sleep(Duration.millis(250 + Math.floor(rng() * 800)));
      if (rng() < 0.1) {
        yield* Effect.logError(`failed ${job.id}`);
        return yield* new WorkerError({ id: job.id });
      }
      yield* Effect.logInfo(`completed ${job.id}`);
      return job;
    }),
  concurrency: 3,
  attempts: 2,
}).pipe(
  Layer.provide(Logs.layer),
  Layer.provide(Logs.persistLayer(TuiNode)),
  Layer.provide(ProcessStorage.layer),
);

// producer daemon: items arrive on their own, mixed priority
const Producer = Layer.effectDiscard(
  Effect.gen(function* () {
    const q = yield* MailQueue;
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const r = rng();
          const item = { id: hexKey() };
          yield* r < 0.2 ? q.prioritize(item) : r < 0.85 ? q.add(item) : q.defer(item);
          yield* Effect.sleep(Duration.millis(350));
        }),
      ),
    );
  }),
);

const AppLayer = Producer.pipe(Layer.provideMerge(QueueLayer));
const runtime = Atom.runtime(AppLayer);

// ── live atoms off the real streams ──────────────────────────────────────────
const statusAtom = runtime.atom(Stream.unwrap(Effect.map(MailQueue, (q) => q.status.changes)));
const metricsAtom = runtime.atom(Stream.unwrap(Effect.map(MailQueue, (q) => q.metrics)));
const trendAtom = runtime.atom(
  Stream.unwrap(Effect.map(MailQueue, (q) => q.status.changes)).pipe(
    Stream.scan([] as ReadonlyArray<number>, (acc, s) =>
      [...acc, s.sizes.high + s.sizes.normal + s.sizes.low].slice(-40),
    ),
  ),
);

interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}
const LEVEL_COLOR: Record<string, string> = {
  Trace: "gray",
  Debug: "gray",
  Info: "white",
  Warning: "yellow",
  Error: "red",
  Fatal: "red",
};

// live log tail via Resource.logs — newest accumulated, capped
const logsAtom = runtime.atom(
  Stream.unwrap(
    Effect.map(Resource.logs(MailQueue), (h) =>
      h.stream.pipe(Stream.filter(LogEntry.hasKey(MailQueue.key))),
    ),
  ).pipe(
    Stream.scan([] as ReadonlyArray<LogLine>, (acc, l) =>
      [
        ...acc,
        { id: (evId += 1), t: Date.now(), level: l.level, message: l.message },
      ].slice(-300),
    ),
  ),
);

// ── controls (real commands) ─────────────────────────────────────────────────
const pauseFn = runtime.fn((_: void) => Effect.flatMap(MailQueue, (q) => q.pause));
const resumeFn = runtime.fn((_: void) => Effect.flatMap(MailQueue, (q) => q.resume));
const clearFn = runtime.fn((_: void) => Effect.flatMap(MailQueue, (q) => q.clear));
const shutdownFn = runtime.fn((_: void) => Effect.flatMap(MailQueue, (q) => q.shutdown));

const WAIT0 = { high: 0, normal: 0, low: 0 };

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
  const [editMode, setEditMode] = React.useState(false);

  const statusR = useAtomValue(statusAtom);
  const metricsR = useAtomValue(metricsAtom);
  const trendR = useAtomValue(trendAtom);
  const logsR = useAtomValue(logsAtom);

  const pause = useAtomSet(pauseFn);
  const resume = useAtomSet(resumeFn);
  const clear = useAtomSet(clearFn);
  const shutdown = useAtomSet(shutdownFn);

  useInput((input, key) => {
    if (key.ctrl && input === "e") {
      setEditMode((x) => !x);
      return;
    }
    if (!editMode) {
      return;
    }
    if (input === "p") {
      pause();
    } else if (input === "r") {
      resume();
    } else if (input === "c") {
      clear();
    } else if (input === "x") {
      shutdown();
    }
  });

  const status = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const metrics = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];

  const sizes: Record<Priority, number> = status?.sizes ?? WAIT0;
  const paused = status?.paused ?? false;
  const phase = status?.phase ?? "running";
  const displayStatus: Status =
    phase === "off"
      ? "off"
      : phase === "draining"
        ? "draining"
        : paused
          ? "paused"
          : "running";
  const view: View = {
    name: NAME,
    status: displayStatus,
    sizes,
    pending: sizes.high + sizes.normal + sizes.low,
    completed: status?.completed ?? 0,
    wait: {
      high: metrics?.avgWaitMillis.high ?? 0,
      normal: metrics?.avgWaitMillis.normal ?? 0,
      low: metrics?.avgWaitMillis.low ?? 0,
    },
    execution: metrics?.avgExecutionMillis ?? 0,
    total: metrics?.avgTotalMillis ?? 0,
    throughput: metrics?.throughputPerSec ?? 0,
    trend,
  };

  const visible = Math.max(1, rows - PAGE_HEIGHT - 5);
  const tail = logs.slice(-visible);

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
            <Text dimColor> · in-flight {status?.inFlight ?? 0}</Text>
          </Box>
          <Text dimColor>phase {phase}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          {tail.map((l) => (
            <Box key={l.id}>
              <Box width={11}>
                <Text dimColor>{timeStr(l.t)}</Text>
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
      </Box>

      <Box paddingX={1} backgroundColor="gray">
        <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT MODE" : "view"}</Text>
        <Text dimColor>
          {editMode
            ? " · Ctrl+E exit · [p] pause [r] resume [c] clear [x] shutdown"
            : " · Ctrl+E edit"}
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
render(
  <RegistryProvider>
    <App />
  </RegistryProvider>,
);
