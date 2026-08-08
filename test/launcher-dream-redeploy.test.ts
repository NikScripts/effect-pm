/**
 * Dream redeploy — file-swap v1→v2 + Update.plan→simulate→execute + WorkPool handoff.
 *
 * Hard live assertions:
 * - Active file content swaps to v2 before B spawn
 * - Directory same-nodeKey dial moves A→B
 * - Sticky lookupClient Probe tip v1 → v2 (same facade)
 * - planUpdate unblocked; clientsAtRisk sees Probe dialer
 * - WorkPool pending count + exact payloads on B after shutdown handoff
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
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import * as Policy from "../src/Policy";
import * as Update from "../src/Update";
import {
  Jobs,
  Probe,
  WORKER_NODE_KEY,
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

const workerNode = (port: number) =>
  Node.Service()(WORKER_NODE_KEY, {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
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
      Effect.provide(Lookup.planStatusOff),
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

describe("Launcher dream redeploy (file-swap v1→v2)", () => {
  it.live(
    "file-swap → Update.execute → sticky tip v2 + WorkPool exact payloads",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = new URL("..", import.meta.url).pathname;
        const launcherDir = `${root}/examples/launcher`;
        const v1Src = `${launcherDir}/dream-redeploy-worker.v1.ts`;
        const v2Src = `${launcherDir}/dream-redeploy-worker.v2.ts`;
        const now = yield* Clock.currentTimeMillis;
        // Unique active path so parallel runs do not clobber each other.
        const active = `${launcherDir}/dream-redeploy-worker.active-${String(process.pid)}-${String(now)}.ts`;
        const lookupPath = `/tmp/hyperlink-ts-dream-redeploy-test-${String(process.pid)}-${String(now)}.sock`;
        const portA = ephemeralPort(now.toString(16), 41);
        const portB = ephemeralPort(now.toString(16), 42);

        const payloads: ReadonlyArray<Job> = [
          { id: "t1", note: "alpha" },
          { id: "t2", note: "beta" },
          { id: "t3", note: "gamma" },
        ];

        yield* reapDreamChildren;
        yield* fs.copyFile(v1Src, active);

        const lookupNode = Node.Service()("lookup/dream-redeploy", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        const child = (port: number) =>
          Launcher.command(
            "pnpm",
            ["exec", "tsx", active, String(port), lookupPath],
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
            const cutover = Policy.make({
              Sticky: true,
              ColdAmbiguous: "fail",
              StreamGap: "stall",
            });

            const nodeA = workerNode(portA);
            const nodeB = workerNode(portB);

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

            const stickyCtx = yield* Layer.build(
              Hyperlink.lookupClient(Probe).pipe(
                Policy.provide(cutover),
                Layer.provide(Lookup.client(lookupNode)),
              ),
            );

            const tipA = yield* Effect.gen(function* () {
              const probe = yield* Probe;
              return yield* probe.tip;
            }).pipe(Effect.provide(stickyCtx));
            expect(tipA).toBe("v1");

            const prePlan = yield* Lookup.planUpdate(WORKER_NODE_KEY, [
              Jobs,
              Probe,
            ]);
            expect(prePlan.blocked).toBe(false);
            expect(
              prePlan.clientsAtRisk.some(
                (row) => row.serviceKey === Probe.key,
              ),
            ).toBe(true);

            yield* Effect.gen(function* () {
              const q = yield* Jobs;
              yield* q.add([...payloads]);
              const snap = yield* q.status.get;
              expect(snap.sizes.normal).toBe(payloads.length);
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, nodeA)),
              Effect.scoped,
            );

            yield* fs.copyFile(v2Src, active);
            const swapped = yield* fs.readFileString(active);
            expect(swapped).toContain('Effect.succeed("v2")');
            expect(swapped).not.toContain('Effect.succeed("v1")');

            const tipStillA = yield* Effect.gen(function* () {
              const probe = yield* Probe;
              return yield* probe.tip;
            }).pipe(Effect.provide(stickyCtx));
            expect(tipStillA).toBe("v1");

            const plan = yield* Update.plan({
              steps: [
                {
                  target: WORKER_NODE_KEY,
                  successor: {
                    node: nodeB,
                    process: child(portB),
                    ready: { timeout: "25 seconds" },
                  },
                  tags: [Jobs, Probe],
                },
              ],
            });
            expect(plan.blocked).toBe(false);
            expect(plan.steps[0]?.impact?.target).toBe(WORKER_NODE_KEY);
            yield* Update.simulate(plan);
            const impacts = yield* Update.execute(plan);
            expect(impacts[0]?.blocked).toBe(false);

            const rows = yield* waitUntil(
              Directory.nodesServing(Jobs),
              (list) =>
                list.length === 1 &&
                list[0]?.nodeKey === WORKER_NODE_KEY &&
                list[0]?.url === `http://127.0.0.1:${String(portB)}/rpc`,
            );
            expect(rows[0]?.url).toBe(
              `http://127.0.0.1:${String(portB)}/rpc`,
            );

            const tipB = yield* waitUntil(
              Effect.gen(function* () {
                const probe = yield* Probe;
                return yield* probe.tip;
              }).pipe(Effect.provide(stickyCtx)),
              (tip) => tip === "v2",
            );
            expect(tipB).toBe("v2");

            const tipDirect = yield* Effect.gen(function* () {
              const probe = yield* Probe;
              return yield* probe.tip;
            }).pipe(
              Effect.provide(Hyperlink.client(Probe, nodeB)),
              Effect.scoped,
            );
            expect(tipDirect).toBe("v2");

            const released = yield* Effect.gen(function* () {
              const q = yield* Jobs;
              const snap = yield* q.status.get;
              expect(snap.sizes.normal).toBe(payloads.length);
              return yield* q.release({});
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, nodeB)),
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
