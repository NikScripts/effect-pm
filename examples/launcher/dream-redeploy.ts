/**
 * @module examples/launcher/dream-redeploy
 *
 * **Dream redeploy (Shape β)** — stable public Http edge + Unix A/B backends.
 *
 * 1. Copy `dream-redeploy-worker.v1.ts` → `dream-redeploy-worker.active.ts`
 * 2. Edge in this process: `Node.forward` on public `Worker` Http
 * 3. `Launcher.up(A)` — Unix backend, Active `"A"`, Probe `"v1"`
 * 4. Public client reads tip `"v1"`; enqueue WorkPool jobs (via forward)
 * 5. File-swap active path to v2; `Launcher.up(B)` loads v2 on Unix B
 * 6. Move pending A→B (interim — Directory is still one row / S14 later)
 * 7. `Node.activate(…, "B")` — tip `"v2"`; clients never change dial
 *
 * ```bash
 * pnpm run example:launcher-dream-redeploy
 * ```
 *
 * Suite: `test/launcher-dream-redeploy.test.ts`.
 * Docs: `docs/examples/launcher/dream-redeploy.md`.
 * Identity: [`dream-redeploy-shared.ts`](./dream-redeploy-shared.ts).
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { NodeFileSystem } from "@effect/platform-node";
import {
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Schedule,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";
import * as NodePolicy from "../../src/NodePolicy";
import {
  Jobs,
  Probe,
  makeDreamNodes,
  type Job,
} from "./dream-redeploy-shared";

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = new URL("../..", import.meta.url).pathname;
  const launcherDir = `${root}/examples/launcher`;
  const v1Src = `${launcherDir}/dream-redeploy-worker.v1.ts`;
  const v2Src = `${launcherDir}/dream-redeploy-worker.v2.ts`;
  const now = yield* Clock.currentTimeMillis;
  const active = `${launcherDir}/dream-redeploy-worker.active.ts`;
  const lookupPath = `/tmp/hyperlink-ts-dream-redeploy-${String(now)}.sock`;
  const sockA = `/tmp/hyperlink-ts-dream-a-${String(now)}.sock`;
  const sockB = `/tmp/hyperlink-ts-dream-b-${String(now)}.sock`;
  const httpPort = 29_100 + (now % 100);

  const payloads: ReadonlyArray<Job> = [
    { id: "1", note: "invoice-a" },
    { id: "2", note: "invoice-b" },
    { id: "3", note: "invoice-c" },
  ];

  yield* fs.copyFile(v1Src, active);
  yield* Effect.logInfo(`1) Active worker = v1 → ${active}`);

  const { Worker, WorkerPrivate } = makeDreamNodes(httpPort, sockA, sockB);

  const edge = Node.withPolicy(
    WorkerPrivate,
    NodePolicy.listen("Primary"),
    NodePolicy.active("A"),
    NodePolicy.advertise("Primary"),
  );
  const backendA = Node.withPolicy(
    WorkerPrivate,
    NodePolicy.as("A"),
    NodePolicy.listen(["A"]),
  );
  const backendB = Node.withPolicy(
    WorkerPrivate,
    NodePolicy.as("B"),
    NodePolicy.listen(["B"]),
  );

  const lookupNode = Node.Service()("examples/dream-redeploy/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);
  const lookupServer = yield* Layer.build(
    Lookup.layerNode(lookupNode, { unlink: true }),
  );
  const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
  const lookupCtx = Context.merge(lookupServer, lookupClient);

  const child = (label: "A" | "B") =>
    Launcher.command(
      "pnpm",
      [
        "exec",
        "tsx",
        active,
        label,
        String(httpPort),
        sockA,
        sockB,
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
    );

  yield* Effect.gen(function* () {
    yield* Effect.logInfo(
      `2) Edge on :${String(httpPort)} (forward Probe → Active)`,
    );
    // Probe via forward (stable public dial). WorkPool forwardAll hang is a
    // known gap — Jobs dial the Active Unix backend directly for this recipe.
    const edgeLayer = Node.http(edge, [Node.forward(edge, Probe)]).pipe(
      Layer.provide(Lookup.client(lookupNode)),
    );
    yield* Layer.build(edgeLayer);

    yield* Effect.logInfo(`3) up A (v1) on ${sockA}`);
    yield* Launcher.up({
      node: backendA,
      process: child("A"),
      ready: { timeout: "25 seconds" },
    });

    const publicClient = yield* Layer.build(Hyperlink.client(Probe, Worker));

    const tipA = yield* Effect.gen(function* () {
      const probe = yield* Probe;
      return yield* probe.tip;
    }).pipe(Effect.provide(publicClient));
    if (tipA !== "v1") {
      return yield* Effect.die(`expected Probe tip v1, got ${tipA}`);
    }
    yield* Effect.logInfo(`4) public Worker Probe.tip → ${tipA}`);

    yield* Effect.gen(function* () {
      const q = yield* Jobs;
      yield* q.add([...payloads]);
      const snap = yield* q.status.get;
      yield* Effect.logInfo(
        `5) Enqueued on A (Unix) — pending normal=${String(snap.sizes.normal)}`,
      );
    }).pipe(Effect.provide(Hyperlink.client(Jobs, backendA)), Effect.scoped);

    yield* Effect.logInfo(
      "6) File-swap active worker → v2 (A still runs v1 in memory)",
    );
    yield* fs.copyFile(v2Src, active);
    const activeBody = yield* fs.readFileString(active);
    if (!activeBody.includes('Effect.succeed("v2")')) {
      return yield* Effect.die(
        "active worker file did not receive v2 tip marker",
      );
    }

    yield* Effect.logInfo(`7) up B (v2) on ${sockB}`);
    yield* Launcher.up({
      node: backendB,
      process: child("B"),
      ready: { timeout: "25 seconds" },
    });

    // Interim: Directory is one row (primary only) — move pending A→B by dial
    // before activate. Multi-row Directory (S14) / Update unpark replace this.
    yield* Effect.logInfo("8) Move WorkPool pending A→B (direct Unix, interim)");
    const pending = yield* Effect.gen(function* () {
      const q = yield* Jobs;
      return yield* q.release({});
    }).pipe(Effect.provide(Hyperlink.client(Jobs, backendA)), Effect.scoped);
    yield* Effect.gen(function* () {
      const q = yield* Jobs;
      yield* q.add(pending.map((e) => e.item));
    }).pipe(Effect.provide(Hyperlink.client(Jobs, backendB)), Effect.scoped);

    yield* Node.activate(WorkerPrivate, "B");
    yield* Effect.logInfo('9) Node.activate(WorkerPrivate, "B")');

    const tipB = yield* waitUntil(
      Effect.gen(function* () {
        const probe = yield* Probe;
        return yield* probe.tip;
      }).pipe(Effect.provide(publicClient)),
      (tip) => tip === "v2",
    );
    yield* Effect.logInfo(`10) public Worker Probe.tip → ${tipB}`);

    const released = yield* Effect.gen(function* () {
      const q = yield* Jobs;
      const snap = yield* q.status.get;
      if (snap.sizes.normal !== payloads.length) {
        return yield* Effect.die(
          `B pending expected ${String(payloads.length)}, got ${String(snap.sizes.normal)}`,
        );
      }
      return yield* q.release({});
    }).pipe(Effect.provide(Hyperlink.client(Jobs, backendB)), Effect.scoped);

    const got = released.map((e) => e.item);
    const same =
      got.length === payloads.length &&
      got.every(
        (item, i) =>
          item.id === payloads[i]!.id && item.note === payloads[i]!.note,
      );
    if (!same) {
      return yield* Effect.die(
        `payload mismatch: expected ${payloads.length} exact jobs on B`,
      );
    }
    yield* Effect.logInfo(
      `11) WorkPool OK — ${String(got.length)} exact payloads on B`,
    );

    yield* Effect.logInfo(
      "Done — dream redeploy β (stable Http + activate A→B).",
    );

    yield* ChildProcess.make("pkill", [
      "-f",
      "dream-redeploy-worker.active.ts",
    ]).pipe(
      Effect.flatMap((h) => h.exitCode),
      Effect.ignore,
    );
  }).pipe(Effect.provide(lookupCtx));
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.merge(Launcher.layer, NodeFileSystem.layer)),
);

// ---cut-after---
NodeRuntime.runMain(program);
