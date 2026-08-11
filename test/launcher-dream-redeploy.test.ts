/**
 * Dream redeploy Shape β — stable Http edge + Unix A/B + activate + file-swap.
 *
 * Hard live assertions:
 * - Active file content swaps to v2 before B spawn
 * - Public Worker dial never changes; tip v1 → v2 after activate
 * - WorkPool exact payloads reachable via public dial after A→B move
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Schedule,
} from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import * as Hyperlink from "../src/Hyperlink";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";
import {
  Jobs,
  Probe,
  makeDreamNodes,
  type Job,
} from "../examples/launcher/dream-redeploy-shared";
import { ephemeralPort, platform } from "./fixtures/launcherHarness";

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const withLookup = <A, E, R>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

const reapDreamChildren = ChildProcess.make("pkill", [
  "-f",
  "dream-redeploy-worker.active",
]).pipe(
  Effect.flatMap((h) => h.exitCode),
  Effect.ignore,
);

describe("Launcher dream redeploy (Shape β forward + activate)", () => {
  it.live(
    "file-swap → activate B → public tip v2 + WorkPool exact payloads",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = new URL("..", import.meta.url).pathname;
        const launcherDir = `${root}/examples/launcher`;
        const v1Src = `${launcherDir}/dream-redeploy-worker.v1.ts`;
        const v2Src = `${launcherDir}/dream-redeploy-worker.v2.ts`;
        const now = yield* Clock.currentTimeMillis;
        const active = `${launcherDir}/dream-redeploy-worker.active-${String(process.pid)}-${String(now)}.ts`;
        const lookupPath = `/tmp/hyperlink-ts-dream-redeploy-test-${String(process.pid)}-${String(now)}.sock`;
        const sockA = `/tmp/hyperlink-ts-dream-a-${String(process.pid)}-${String(now)}.sock`;
        const sockB = `/tmp/hyperlink-ts-dream-b-${String(process.pid)}-${String(now)}.sock`;
        const httpPort = ephemeralPort(now.toString(16), 41);

        const payloads: ReadonlyArray<Job> = [
          { id: "t1", note: "alpha" },
          { id: "t2", note: "beta" },
          { id: "t3", note: "gamma" },
        ];

        yield* reapDreamChildren;
        yield* fs.copyFile(v1Src, active);

        const { Worker, WorkerPrivate } = makeDreamNodes(
          httpPort,
          sockA,
          sockB,
        );
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

        const lookupNode = Node.Service()("lookup/dream-redeploy", {
          path: lookupPath,
        }).pipe(Node.asLookup);

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
            {
              cwd: root,
              stdout: "inherit",
              stderr: "inherit",
              token: "env",
            },
          );

        yield* withLookup(
          Lookup.layerNode(lookupNode, { unlink: true }),
          Lookup.client(lookupNode),
          Effect.gen(function* () {
            const edgeLayer = Node.http(edge, [
              Node.forward(edge, Probe),
            ]).pipe(Layer.provide(Lookup.client(lookupNode)));
            yield* Layer.build(edgeLayer);

            yield* Launcher.up({
              node: backendA,
              process: child("A"),
              ready: { timeout: "25 seconds" },
            });

            const publicClient = yield* Layer.build(
              Hyperlink.client(Probe, Worker),
            );

            const tipA = yield* Effect.gen(function* () {
              const probe = yield* Probe;
              return yield* probe.tip;
            }).pipe(Effect.provide(publicClient));
            expect(tipA).toBe("v1");

            yield* Effect.gen(function* () {
              const q = yield* Jobs;
              yield* q.add([...payloads]);
              const snap = yield* q.status.get;
              expect(snap.sizes.normal).toBe(payloads.length);
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, backendA)),
              Effect.scoped,
            );

            yield* fs.copyFile(v2Src, active);
            const swapped = yield* fs.readFileString(active);
            expect(swapped).toContain('Effect.succeed("v2")');
            expect(swapped).not.toContain('Effect.succeed("v1")');

            const tipStillA = yield* Effect.gen(function* () {
              const probe = yield* Probe;
              return yield* probe.tip;
            }).pipe(Effect.provide(publicClient));
            expect(tipStillA).toBe("v1");

            yield* Launcher.up({
              node: backendB,
              process: child("B"),
              ready: { timeout: "25 seconds" },
            });

            const pending = yield* Effect.gen(function* () {
              const q = yield* Jobs;
              return yield* q.release({});
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, backendA)),
              Effect.scoped,
            );
            yield* Effect.gen(function* () {
              const q = yield* Jobs;
              yield* q.add(pending.map((e) => e.item));
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, backendB)),
              Effect.scoped,
            );

            yield* Node.activate(WorkerPrivate, "B");

            const tipB = yield* waitUntil(
              Effect.gen(function* () {
                const probe = yield* Probe;
                return yield* probe.tip;
              }).pipe(Effect.provide(publicClient)),
              (tip) => tip === "v2",
            );
            expect(tipB).toBe("v2");

            const released = yield* Effect.gen(function* () {
              const q = yield* Jobs;
              const snap = yield* q.status.get;
              expect(snap.sizes.normal).toBe(payloads.length);
              return yield* q.release({});
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, backendB)),
              Effect.scoped,
            );
            expect(released.map((e) => e.item)).toEqual([...payloads]);

            yield* reapDreamChildren;
            yield* fs.remove(active, { force: true }).pipe(Effect.ignore);
          }),
        );
      }).pipe(
        Effect.timeout(Duration.seconds(90)),
        Effect.provide(Layer.merge(platform, NodeFileSystem.layer)),
      ),
    { timeout: 90_000 },
  );
});
