/**
 * Launcher.restartSuccessor — plan blocks before spawn; ambient Layers;
 * live happy-path A→B (OS children + Directory dial-replace).
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
  type Scope,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";
import {
  ephemeralPort,
  platform,
  reapRestartChildren,
  restartChildEntryPaths,
} from "./fixtures/launcherHarness";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-restart-${label}-${process.pid}-${now}.sock`;
  });

const withLookup = <A, E>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, Lookup.Services | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Lookup.planStatusOff),
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

/** Live child Spec — matches `launcher-restart-child.ts`. */
class Jobs extends Hyperlink.Tag<Jobs>()("restart-successor/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

/** Synthetic Specs for UpdateBlocked (do not claim a second wire key). */
const jobsIncumbentBlocked: Lookup.PlanUpdateTag = {
  key: "restart-successor/Jobs",
  [Hyperlink.wireKeySym]: "restart-successor/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
    legacy: Hyperlink.effect(Schema.String),
  },
};

const jobsNext: Lookup.PlanUpdateTag = {
  key: "restart-successor/Jobs",
  [Hyperlink.wireKeySym]: "restart-successor/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
  },
};

const workerNode = (port: number) =>
  Node.Tag()("restart/worker", {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
  });

const restartChildProcess = (
  root: string,
  entry: string,
  port: number,
  lookupPath: string,
) =>
  Launcher.command(
    "pnpm",
    ["exec", "tsx", entry, String(port), lookupPath],
    {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      token: "env",
    },
  );

describe("Launcher.restartSuccessor", () => {
  it.effect(
    "UpdateBlocked from plan stops before successor spawn",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("blocked");
        const node = Node.Tag()("lookup/restart-blocked", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a-restart.sock",
                serves: ["restart-successor/Jobs"],
              }),
            );

            const successor = Node.Tag()("restart/worker-b", {
              url: "http://127.0.0.1:1/rpc",
              kind: "Http",
            });
            const exit = yield* Effect.exit(
              Launcher.restartSuccessor({
                target: "worker-a",
                successor: {
                  node: successor,
                  process: Launcher.command("sleep", ["120"]),
                },
                tags: [jobsNext],
                incumbent: [jobsIncumbentBlocked],
              }).pipe(Effect.provide(Launcher.layer)),
            );
            expectTaggedFailure(exit, "UpdateBlocked");
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "AlreadyUpRef adopt is ambient (no per-call alreadyUp)",
    () =>
      Effect.gen(function* () {
        const ambient = yield* Launcher.AlreadyUpRef;
        expect(ambient).toBe("fail");
        const adopted = yield* Launcher.AlreadyUpRef.pipe(
          Effect.provide(Launcher.alreadyUpAdopt),
        );
        expect(adopted).toBe("adopt");
      }),
  );

  it.live(
    "plan ok → up(B) → shutdown(A); Directory dial moves to B",
    () =>
      Effect.gen(function* () {
        yield* reapRestartChildren;
        const { root, entry } = restartChildEntryPaths();
        const lookupPath = yield* tmpSock("live");
        const now = yield* Clock.currentTimeMillis;
        const portA = ephemeralPort(now.toString(16), 31);
        const portB = ephemeralPort(now.toString(16), 32);

        const lookupNode = Node.Tag()("lookup/restart-live", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        yield* withLookup(
          Lookup.layerNode(lookupNode, { unlink: true }),
          Lookup.client(lookupNode),
          Effect.gen(function* () {
            const nodeA = workerNode(portA);
            const nodeB = workerNode(portB);

            yield* Launcher.up({
              node: nodeA,
              process: restartChildProcess(root, entry, portA, lookupPath),
              ready: { timeout: "25 seconds" },
            });

            yield* waitUntil(
              Directory.nodesServing(Jobs),
              (rows) =>
                rows.some(
                  (row) =>
                    row.nodeKey === "restart/worker" &&
                    row.url === `http://127.0.0.1:${String(portA)}/rpc`,
                ),
            );

            const impact = yield* Launcher.restartSuccessor({
              target: "restart/worker",
              successor: {
                node: nodeB,
                process: restartChildProcess(root, entry, portB, lookupPath),
                ready: { timeout: "25 seconds" },
              },
              tags: [Jobs],
            });

            expect(impact).toBeDefined();
            expect(impact?.blocked).toBe(false);
            expect(impact?.target).toBe("restart/worker");

            const rows = yield* waitUntil(
              Directory.nodesServing(Jobs),
              (list) =>
                list.some(
                  (row) =>
                    row.nodeKey === "restart/worker" &&
                    row.url === `http://127.0.0.1:${String(portB)}/rpc`,
                ),
            );
            const row = rows.find((r) => r.nodeKey === "restart/worker");
            expect(row?.url).toBe(`http://127.0.0.1:${String(portB)}/rpc`);

            // B answers; Directory dial already moved off A.
            const ping = yield* Effect.gen(function* () {
              const jobs = yield* Jobs;
              return yield* jobs.ping;
            }).pipe(
              Effect.provide(Hyperlink.client(Jobs, nodeB)),
              Effect.scoped,
            );
            expect(ping).toBe("pong");

            yield* reapRestartChildren;
          }),
        );
      }).pipe(
        Effect.timeout(Duration.seconds(60)),
        Effect.provide(platform),
      ),
    { timeout: 60_000 },
  );
});
