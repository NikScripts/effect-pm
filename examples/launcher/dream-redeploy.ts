/**
 * @module examples/launcher/dream-redeploy
 *
 * **Dream redeploy** — launch v1 → live traffic → **file-swap** to v2 →
 * `Launcher.restartSuccessor` → WorkPool pending handoff → sticky client on v2.
 *
 * 1. Copy `dream-redeploy-worker.v1.ts` → `dream-redeploy-worker.active.ts`
 * 2. `Launcher.up(A)` from the **active** path (OS loads v1)
 * 3. Sticky `lookupClient` reads Probe `"v1"`; enqueue WorkPool jobs on A
 * 4. Copy `dream-redeploy-worker.v2.ts` over the **same** active path (update)
 * 5. `restartSuccessor` ups B from that path (OS loads v2), prefer, shutdown A
 * 6. Directory dial → B; sticky Probe `"v2"`; B holds exact pending payloads
 *
 * Active path stays beside the v1/v2 sources so relative imports keep resolving.
 *
 * ```bash
 * pnpm run example:launcher-dream-redeploy
 * ```
 *
 * Suite: `test/launcher-dream-redeploy.test.ts`.
 * Docs: `docs/examples/launcher/dream-redeploy.md`.
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
import * as Directory from "../../src/Directory";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";
import * as Policy from "../../src/Policy";
import {
  Jobs,
  Probe,
  WORKER_NODE_KEY,
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

const workerNode = (port: number) =>
  Node.Tag()(WORKER_NODE_KEY, {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
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
  const portA = 29_100 + (now % 100);
  const portB = portA + 1;

  const payloads: ReadonlyArray<Job> = [
    { id: "1", note: "invoice-a" },
    { id: "2", note: "invoice-b" },
    { id: "3", note: "invoice-c" },
  ];

  yield* fs.copyFile(v1Src, active);
  yield* Effect.logInfo(`1) Active worker = v1 → ${active}`);

  const lookupNode = Node.Tag()("examples/dream-redeploy/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);
  const lookupServer = yield* Layer.build(
    Lookup.layerNode(lookupNode, { unlink: true }),
  );
  const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
  const lookupCtx = Context.merge(lookupServer, lookupClient);

  const cutover = Policy.make({
    Sticky: true,
    ColdAmbiguous: "fail",
    StreamGap: "stall",
  });

  const child = (port: number) =>
    Launcher.command(
      "pnpm",
      ["exec", "tsx", active, String(port), lookupPath],
      { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
    );

  yield* Effect.gen(function* () {
    const nodeA = workerNode(portA);
    const nodeB = workerNode(portB);

    yield* Effect.logInfo(`2) up A (v1) on :${String(portA)}`);
    yield* Launcher.up({
      node: nodeA,
      process: child(portA),
      ready: { timeout: "25 seconds" },
    });

    yield* waitUntil(
      Directory.nodesServing(Jobs),
      (rows) =>
        rows.some(
          (row) =>
            row.nodeKey === WORKER_NODE_KEY &&
            row.url === `http://127.0.0.1:${String(portA)}/rpc`,
        ),
    );

    const stickyClient = yield* Layer.build(
      Hyperlink.lookupClient(Probe).pipe(
        Policy.provide(cutover),
        Layer.provide(Lookup.client(lookupNode)),
      ),
    );

    const tipA = yield* Effect.gen(function* () {
      const probe = yield* Probe;
      return yield* probe.tip;
    }).pipe(Effect.provide(stickyClient));
    if (tipA !== "v1") {
      return yield* Effect.die(`expected Probe tip v1, got ${tipA}`);
    }
    yield* Effect.logInfo(`3) sticky lookupClient Probe.tip → ${tipA}`);

    yield* Effect.gen(function* () {
      const q = yield* Jobs;
      yield* q.add([...payloads]);
      const snap = yield* q.status.get;
      yield* Effect.logInfo(
        `4) Enqueued on A — pending normal=${String(snap.sizes.normal)}`,
      );
    }).pipe(Effect.provide(Hyperlink.client(Jobs, nodeA)), Effect.scoped);

    yield* Effect.logInfo(
      "5) File-swap active worker → v2 (A still runs v1 in memory)",
    );
    yield* fs.copyFile(v2Src, active);
    const activeBody = yield* fs.readFileString(active);
    if (!activeBody.includes('Effect.succeed("v2")')) {
      return yield* Effect.die(
        "active worker file did not receive v2 tip marker",
      );
    }

    yield* Effect.logInfo(
      `6) restartSuccessor → up B (v2) on :${String(portB)} → prefer → shutdown A`,
    );
    const impact = yield* Launcher.restartSuccessor({
      target: WORKER_NODE_KEY,
      successor: {
        node: nodeB,
        process: child(portB),
        ready: { timeout: "25 seconds" },
      },
      tags: [Jobs, Probe],
    });
    if (impact?.blocked === true) {
      return yield* Effect.die("planUpdate blocked unexpectedly");
    }

    yield* waitUntil(
      Directory.nodesServing(Jobs),
      (rows) =>
        rows.length === 1 &&
        rows[0]?.nodeKey === WORKER_NODE_KEY &&
        rows[0]?.url === `http://127.0.0.1:${String(portB)}/rpc`,
    );
    yield* Effect.logInfo("7) Directory dial → B (same nodeKey)");

    const tipB = yield* waitUntil(
      Effect.gen(function* () {
        const probe = yield* Probe;
        return yield* probe.tip;
      }).pipe(Effect.provide(stickyClient)),
      (tip) => tip === "v2",
    );
    yield* Effect.logInfo(`8) sticky lookupClient Probe.tip → ${tipB}`);

    const released = yield* Effect.gen(function* () {
      const q = yield* Jobs;
      const snap = yield* q.status.get;
      if (snap.sizes.normal !== payloads.length) {
        return yield* Effect.die(
          `B pending expected ${String(payloads.length)}, got ${String(snap.sizes.normal)}`,
        );
      }
      return yield* q.release({});
    }).pipe(Effect.provide(Hyperlink.client(Jobs, nodeB)), Effect.scoped);

    const got = released.map((e) => e.item);
    if (JSON.stringify(got) !== JSON.stringify(payloads)) {
      return yield* Effect.die(
        `payload mismatch: ${JSON.stringify(got)} !== ${JSON.stringify(payloads)}`,
      );
    }
    yield* Effect.logInfo(
      `9) WorkPool handoff OK — ${String(got.length)} exact payloads on B`,
    );

    yield* Effect.logInfo("Done — dream redeploy (file-swap v1→v2) complete.");

    yield* ChildProcess.make("pkill", [
      "-f",
      "dream-redeploy-worker.active.ts",
    ]).pipe(
      Effect.flatMap((h) => h.exitCode),
      Effect.ignore,
    );
  }).pipe(
    Effect.provide(Lookup.planStatusOff),
    Effect.provide(lookupCtx),
  );
}).pipe(
  Effect.scoped,
  Effect.provide(Launcher.layer),
  Effect.provide(NodeFileSystem.layer),
);

// ---cut-after---
NodeRuntime.runMain(program);
