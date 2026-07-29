/**
 * @module examples/apps/tui/handoff-ab-live
 *
 * **Watchable A→B handoff** — dual-pane Ink TUI over the real Locked #39 cutover.
 *
 * Left = Worker A (outgoing), right = Worker B (Directory peer). Pending jobs sit with
 * `autoStart: false`. Autoplay enqueues on A, then `Node.shutdown(A)` — watch the count
 * jump A → B as baked `releaseEnqueueHandoff` runs.
 *
 * Needs a real TTY (alt-screen). In your terminal:
 *
 * ```bash
 * pnpm run example:handoff-ab-live
 * ```
 *
 * Keys: **a** enqueue · **h** handoff · Ctrl+C quit.
 */

import { Box, render, Text, useInput, useStdout } from "ink";
import * as React from "react";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Path,
  Ref,
  Schedule,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Lookup from "../../../src/Lookup";
import * as Directory from "../../../src/Directory";
import * as Node from "../../../src/Node";
import * as WorkPool from "../../../src/WorkPool";

// ── domain ───────────────────────────────────────────────────────────────────

const Job = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
});

type Phase = "booting" | "ready" | "handing-off" | "done" | "failed";

interface Board {
  readonly phase: Phase;
  readonly aPending: number;
  readonly bPending: number;
  readonly aNotes: ReadonlyArray<string>;
  readonly bNotes: ReadonlyArray<string>;
  readonly directory: ReadonlyArray<string>;
  readonly banner: string;
  readonly tick: number;
}

const emptyBoard: Board = {
  phase: "booting",
  aPending: 0,
  bPending: 0,
  aNotes: [],
  bNotes: [],
  directory: [],
  banner: "booting Lookup + A + B…",
  tick: 0,
};

interface Controls {
  readonly enqueue: Effect.Effect<void>;
  readonly handoff: Effect.Effect<void>;
}

const boardRef = Effect.runSync(SubscriptionRef.make(emptyBoard));
const controlsRef = Effect.runSync(Ref.make<Controls | null>(null));

/** Optional plain-text board trail for CI / non-interactive capture (`HANDOFF_LIVE_SNAPSHOT=path`). */
const snapshotPath =
  typeof process.env.HANDOFF_LIVE_SNAPSHOT === "string" &&
  process.env.HANDOFF_LIVE_SNAPSHOT.length > 0
    ? process.env.HANDOFF_LIVE_SNAPSHOT
    : undefined;

let lastSnapshotKey = "";

const appendSnapshot = (board: Board): Effect.Effect<void> => {
  if (snapshotPath === undefined) return Effect.void;
  const key =
    `${board.phase}|${String(board.aPending)}|${String(board.bPending)}|` +
    `${board.directory.join(",")}|${board.banner}`;
  if (key === lastSnapshotKey) return Effect.void;
  lastSnapshotKey = key;
  const line =
    `${board.phase}\ta=${String(board.aPending)}\tb=${String(board.bPending)}\t` +
    `dir=${board.directory.join(",")}\t${board.banner}\n`;
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathSvc = yield* Path.Path;
    const dir = pathSvc.dirname(snapshotPath);
    yield* fs.makeDirectory(dir, { recursive: true });
    const exists = yield* fs.exists(snapshotPath);
    if (exists) {
      const prev = yield* fs.readFileString(snapshotPath);
      yield* fs.writeFileString(snapshotPath, prev + line);
    } else {
      yield* fs.writeFileString(snapshotPath, line);
    }
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.catch(() => Effect.void),
  );
};

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const nodesServing = (
  lookupCtx: Context.Context<Directory.Tag>,
  serviceKey: string,
) =>
  Context.get(lookupCtx, Directory.Tag)
    .nodesServing(new Lookup.NodesServingRequest({ serviceKey }))
    .pipe(Effect.provide(lookupCtx));

const boot = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const lookupPath = `/tmp/hyperlink-ts-handoff-live-lookup-${String(now)}.sock`;
  const pathA = `/tmp/hyperlink-ts-handoff-live-a-${String(now)}.sock`;
  const pathB = `/tmp/hyperlink-ts-handoff-live-b-${String(now)}.sock`;

  const lookupNode = Node.Tag()("examples/handoff-live/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class Jobs extends WorkPool.Tag<Jobs>()("examples/handoff-live/Jobs", {
    payload: Job,
  }) {}

  class WorkerA extends Node.Tag<WorkerA, Jobs>()("examples/handoff-live/WorkerA", {
    path: pathA,
  }) {}
  class WorkerB extends Node.Tag<WorkerB, Jobs>()("examples/handoff-live/WorkerB", {
    path: pathB,
  }) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  // B first — Directory peer for A's handoff (exclude self by dial).
  yield* Layer.build(
    Node.unix(WorkerB, [
      WorkPool.serve(Jobs, {
        effect: () => Effect.void,
        autoStart: false,
      }),
    ]).pipe(Layer.provide(lookupClient)),
  );
  const aCtx = yield* Layer.build(
    Node.unix(WorkerA, [
      WorkPool.serve(Jobs, {
        effect: () => Effect.void,
        autoStart: false,
      }),
    ]).pipe(Layer.provide(lookupClient)),
  );

  yield* waitUntil(nodesServing(lookupCtx, Jobs.key), (rows) => rows.length === 2);

  const aNotes = yield* SubscriptionRef.make<ReadonlyArray<string>>([]);
  let nextId = 0;

  const readPending = (node: typeof WorkerA | typeof WorkerB) =>
    Effect.gen(function* () {
      const q = yield* Jobs;
      const snap = yield* q.status.get;
      return snap.sizes.normal + snap.sizes.high + snap.sizes.low;
    }).pipe(
      Effect.provide(Hyperlink.client(Jobs, node)),
      Effect.scoped,
      Effect.catch(() => Effect.succeed(-1)),
    );

  const refresh = Effect.gen(function* () {
    const aPending = yield* readPending(WorkerA);
    const bPending = yield* readPending(WorkerB);
    const notes = yield* SubscriptionRef.get(aNotes);
    const rows = yield* nodesServing(lookupCtx, Jobs.key);
    const phase = (yield* SubscriptionRef.get(boardRef)).phase;
    const transferred =
      phase === "done" || (aPending <= 0 && bPending > 0 && phase !== "booting");
    yield* SubscriptionRef.update(boardRef, (b) => ({
      ...b,
      aPending: aPending < 0 ? 0 : aPending,
      bPending: bPending < 0 ? 0 : bPending,
      aNotes: aPending < 0 || phase === "done" ? [] : notes,
      bNotes: transferred ? notes : b.bNotes,
      directory: rows.map((r) => r.nodeKey.split("/").pop() ?? r.nodeKey),
      tick: b.tick + 1,
    }));
  });

  yield* Effect.forkChild(
    Stream.runForEach(SubscriptionRef.changes(boardRef), appendSnapshot),
  );

  yield* Effect.forkChild(
    Effect.forever(Effect.andThen(refresh, Effect.sleep(Duration.millis(100)))),
  );

  const enqueue = Effect.gen(function* () {
    const phase = (yield* SubscriptionRef.get(boardRef)).phase;
    if (phase !== "ready") return;
    const id = String((nextId += 1));
    const note = `job-${id}`;
    yield* Effect.gen(function* () {
      const q = yield* Jobs;
      yield* q.add({ id, note });
    }).pipe(Effect.provide(aCtx));
    yield* SubscriptionRef.update(aNotes, (xs) => [...xs, note]);
    yield* SubscriptionRef.update(boardRef, (b) => ({
      ...b,
      banner: `enqueued ${note} on A`,
    }));
    yield* refresh;
  });

  const handoff = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(boardRef);
    if (current.phase !== "ready") return;
    yield* SubscriptionRef.update(boardRef, (b) => ({
      ...b,
      phase: "handing-off" as const,
      banner: "Node.shutdown(A) — drain → releaseEnqueueHandoff → leave…",
    }));
    const exit = yield* Effect.exit(Node.shutdown(WorkerA));
    if (exit._tag === "Failure") {
      yield* SubscriptionRef.update(boardRef, (b) => ({
        ...b,
        phase: "failed" as const,
        banner: "handoff deferred/failed — A stayed up",
      }));
      return;
    }
    yield* waitUntil(nodesServing(lookupCtx, Jobs.key), (rows) =>
      rows.every((r) => r.nodeKey !== WorkerA.key),
    );
    yield* refresh;
    const notes = yield* SubscriptionRef.get(aNotes);
    const bPending = yield* readPending(WorkerB);
    yield* SubscriptionRef.update(boardRef, (b) => ({
      ...b,
      phase: "done" as const,
      aPending: 0,
      aNotes: [],
      bPending: bPending < 0 ? notes.length : bPending,
      bNotes: notes,
      banner: `handoff Done — ${String(notes.length)} job(s) now on B`,
    }));
  });

  yield* Ref.set(controlsRef, { enqueue, handoff });
  yield* SubscriptionRef.update(boardRef, (b) => ({
    ...b,
    phase: "ready" as const,
    banner: "ready — autoplay enqueues on A, then hands off (or press a / h)",
    directory: ["WorkerA", "WorkerB"],
  }));

  // Autoplay: fill A, pause so you can watch, then handoff.
  yield* Effect.forkChild(
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.seconds(1));
      for (let i = 0; i < 5; i++) {
        if ((yield* SubscriptionRef.get(boardRef)).phase !== "ready") return;
        yield* enqueue;
        yield* Effect.sleep(Duration.millis(400));
      }
      yield* SubscriptionRef.update(boardRef, (b) =>
        b.phase === "ready"
          ? {
              ...b,
              banner: "watching A hold pending… handoff in 2s (or press h)",
            }
          : b,
      );
      yield* Effect.sleep(Duration.seconds(2));
      if ((yield* SubscriptionRef.get(boardRef)).phase === "ready") {
        yield* handoff;
      }
    }),
  );

  return yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.provide(Logger.layer([], { mergeWithExisting: false })),
);

Effect.runFork(boot);

const runControl = (pick: (c: Controls) => Effect.Effect<void>): void => {
  void Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Ref.get(controlsRef);
      if (c !== null) yield* pick(c);
    }),
  );
};

// ── UI ───────────────────────────────────────────────────────────────────────

const useTerminalSize = (): { cols: number; rows: number } => {
  const { stdout } = useStdout();
  const [size, setSize] = React.useState({
    cols: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 28,
  });
  React.useEffect(() => {
    if (stdout === undefined) return;
    const onResize = () => setSize({ cols: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
};

const useBoard = (): Board => {
  const [board, setBoard] = React.useState<Board>(emptyBoard);
  React.useEffect(() => {
    const fiber = Effect.runFork(
      Stream.runForEach(SubscriptionRef.changes(boardRef), (b) =>
        Effect.sync(() => {
          setBoard(b);
        }),
      ),
    );
    return () => {
      void Effect.runPromise(Fiber.interrupt(fiber));
    };
  }, []);
  return board;
};

const NodePane = (props: {
  readonly title: string;
  readonly role: string;
  readonly pending: number;
  readonly notes: ReadonlyArray<string>;
  readonly alive: boolean;
  readonly accent: string;
  readonly width: number;
}): React.ReactElement => {
  const { title, role, pending, notes, alive, accent, width } = props;
  const show = notes.slice(0, 12);
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={alive ? accent : "gray"}
      paddingX={1}
    >
      <Box>
        <Text bold color={alive ? accent : "gray"}>
          {title}
        </Text>
        <Text dimColor> · {role}</Text>
      </Box>
      <Box marginY={1}>
        <Text color={alive ? accent : "gray"}>pending </Text>
        <Text bold color={alive ? "white" : "gray"}>
          {alive ? String(pending) : "—"}
        </Text>
        <Text dimColor>  {alive ? "up" : "left"}</Text>
      </Box>
      <Box flexDirection="column" height={12}>
        {show.length === 0 ? (
          <Text dimColor>{alive ? "(empty)" : "(gone)"}</Text>
        ) : (
          show.map((n) => (
            <Text key={n} color={alive ? "white" : "gray"}>
              • {n}
            </Text>
          ))
        )}
        {notes.length > show.length ? (
          <Text dimColor>… +{String(notes.length - show.length)} more</Text>
        ) : null}
      </Box>
    </Box>
  );
};

const App = (): React.ReactElement => {
  const { cols, rows } = useTerminalSize();
  const board = useBoard();

  useInput((input) => {
    if (input === "a") runControl((c) => c.enqueue);
    if (input === "h") runControl((c) => c.handoff);
  });

  const paneW = Math.max(28, Math.floor((cols - 6) / 2));
  const showAAlive =
    board.phase === "ready" ||
    board.phase === "handing-off" ||
    board.phase === "booting";

  const phaseColor =
    board.phase === "done"
      ? "green"
      : board.phase === "handing-off"
        ? "yellow"
        : board.phase === "failed"
          ? "red"
          : "cyan";

  return (
    <Box flexDirection="column" width={cols} height={rows} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Hyperlink · A→B handoff</Text>
        <Text dimColor>  Locked #39 · WorkPool.releaseEnqueueHandoff</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={phaseColor}>phase {board.phase}</Text>
        <Text dimColor>  Directory: </Text>
        <Text>{board.directory.join(" · ") || "…"}</Text>
        <Text dimColor>  tick {String(board.tick)}</Text>
      </Box>

      <Box>
        <NodePane
          title="Worker A"
          role="outgoing"
          pending={board.aPending}
          notes={board.aNotes}
          alive={showAAlive}
          accent="magenta"
          width={paneW}
        />
        <Box width={3} justifyContent="center" alignItems="center">
          <Text color="yellow">
            {board.phase === "handing-off"
              ? "⇒"
              : board.phase === "done"
                ? "✓"
                : "·"}
          </Text>
        </Box>
        <NodePane
          title="Worker B"
          role="peer (Directory)"
          pending={board.bPending}
          notes={board.bNotes}
          alive={true}
          accent="cyan"
          width={paneW}
        />
      </Box>

      <Box marginTop={1}>
        <Text>{board.banner}</Text>
      </Box>

      <Box marginTop={1} backgroundColor="gray">
        <Text color="black">
          {" "}
          [a] enqueue on A · [h] Node.shutdown(A) handoff · Ctrl+C quit ·
          autoplay on{" "}
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
