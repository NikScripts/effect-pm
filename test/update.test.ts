/**
 * Update.plan → simulate → execute — fleet order, contracts, blocked, live A→B.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
  SchemaTransformation,
} from "effect";
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import * as Update from "../src/Update";
import * as Versioned from "../src/Versioned";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";
import {
  ephemeralPort,
  platform,
  reapRestartChildren,
  restartChildEntryPaths,
} from "./fixtures/launcherHarness";

/** WorkPool stamps this; Update contracts read tip via the same symbol. */
const workPoolItemSchemaSym = Symbol.for("hyperlink-ts/WorkPool/itemSchema");

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-update-${label}-${process.pid}-${now}.sock`;
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

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

class Jobs extends Hyperlink.Service<Jobs>()("update-plan/Jobs", {
  run: Hyperlink.effect(Schema.Number),
  legacy: Hyperlink.effect(Schema.String),
}) {}

class Mail extends Hyperlink.Service<Mail>()("update-plan/Mail", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const jobsNext: Lookup.PlanUpdateTag = {
  key: "update-plan/Jobs",
  [Hyperlink.wireKeySym]: "update-plan/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
  },
};

class JobV1 extends Schema.Class<JobV1>("update/job@1")({
  id: Schema.String,
}) {}
class JobV2 extends Schema.Class<JobV2>("update/job@2")({
  id: Schema.String,
  note: Schema.String,
}) {}

const toV2 = SchemaTransformation.transform({
  decode: (j: JobV1): JobV2 => new JobV2({ id: j.id, note: "" }),
  encode: ({ note: _n, ...j }: JobV2): JobV1 => new JobV1(j),
});

const JobChain = Versioned.make(JobV1).migrate(JobV2, toV2);

/** Structural PlanUpdateTag carrying a Versioned WorkPool item schema. */
const VersionedJobs = Object.assign(
  {
    key: "update-plan/VersionedJobs",
    [Hyperlink.wireKeySym]: "update-plan/VersionedJobs",
    [Hyperlink.specSym]: {
      run: Hyperlink.effect(Schema.Number),
    },
  } satisfies Lookup.PlanUpdateTag,
  { [workPoolItemSchemaSym]: JobChain },
);

/** Live child Spec — matches `launcher-restart-child.ts`. */
class RestartJobs extends Hyperlink.Service<RestartJobs>()(
  "restart-successor/Jobs",
  { ping: Hyperlink.effect(Schema.String) },
) {}

const workerNode = (port: number) =>
  Node.Service()("restart/worker", {
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

describe("Update.plan / simulate", () => {
  it.effect("fails EmptyUpdatePlan when steps is empty", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("empty");
      const node = Node.Service()("update/empty", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const exit = yield* Effect.exit(Update.plan({ steps: [] }));
          expectTaggedFailure(exit, "EmptyUpdatePlan");
        }),
      );
    }),
  );

  it.effect("orders steps and attaches planUpdate impacts", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("order");
      const node = Node.Service()("update/order", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Service;
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "mail-a",
              kind: "IpcSocket",
              path: "/tmp/mail-a.sock",
              serves: ["update-plan/Mail"],
            }),
          );
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "jobs-a",
              kind: "IpcSocket",
              path: "/tmp/jobs-a.sock",
              serves: ["update-plan/Jobs"],
            }),
          );

          const dummy = Node.Service()("update/order-b", {
            path: "/tmp/order-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });

          const plan = yield* Update.plan({
            steps: [
              {
                target: "mail-a",
                successor: { node: dummy, process },
                tags: [Mail],
              },
              {
                target: "jobs-a",
                successor: { node: dummy, process },
                tags: [Jobs],
              },
            ],
          });

          expect(Update.isPlan(plan)).toBe(true);
          expect(plan.steps.map((s) => s.target)).toEqual(["mail-a", "jobs-a"]);
          expect(plan.steps[0]?.order).toBe(0);
          expect(plan.steps[1]?.order).toBe(1);
          expect(plan.steps[0]?.impact?.target).toBe("mail-a");
          expect(plan.steps[1]?.impact?.target).toBe("jobs-a");
          expect(plan.blocked).toBe(false);

          const sim = yield* Update.simulate(plan);
          expect(sim.ok).toBe(true);
        }),
      );
    }),
  );

  it.effect("fails ContractMismatch when successor tip ≠ contract.to", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract");
      const node = Node.Service()("update/contract", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Service;
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "vj-a",
              kind: "IpcSocket",
              path: "/tmp/vj-a.sock",
              serves: ["update-plan/VersionedJobs"],
            }),
          );
          const dummy = Node.Service()("update/contract-b", {
            path: "/tmp/contract-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });

          const tip = Versioned.schemaVersion(JobChain);
          expect(tip).toBe("update/job@2");

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "vj-a",
                  successor: { node: dummy, process },
                  tags: [VersionedJobs],
                },
              ],
              contracts: [
                {
                  tag: VersionedJobs,
                  to: "update/job@1",
                },
              ],
            }),
          );
          expectTaggedFailure(exit, "ContractMismatch");
        }),
      );
    }),
  );

  it.effect("plan surfaces UpdateBlocked for wireRemovals (fail closed)", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("blocked");
      const node = Node.Service()("update/blocked", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Service;
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "jobs-a",
              kind: "IpcSocket",
              path: "/tmp/jobs-blocked.sock",
              serves: ["update-plan/Jobs"],
            }),
          );
          const dummy = Node.Service()("update/blocked-b", {
            path: "/tmp/blocked-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "jobs-a",
                  successor: { node: dummy, process },
                  tags: [jobsNext],
                  incumbent: [Jobs],
                },
              ],
            }),
          );
          expectTaggedFailure(exit, "UpdateBlocked");
        }),
      );
    }),
  );

  it.effect("contracts.to matching tip audits ok", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract-ok");
      const node = Node.Service()("update/contract-ok", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Service;
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "vj-ok",
              kind: "IpcSocket",
              path: "/tmp/vj-ok.sock",
              serves: ["update-plan/VersionedJobs"],
            }),
          );
          const dummy = Node.Service()("update/contract-ok-b", {
            path: "/tmp/contract-ok-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });
          const tip = Versioned.schemaVersion(JobChain);

          const plan = yield* Update.plan({
            steps: [
              {
                target: "vj-ok",
                successor: { node: dummy, process },
                tags: [VersionedJobs],
              },
            ],
            contracts: [{ tag: VersionedJobs, to: tip }],
          });
          expect(plan.blocked).toBe(false);
          expect(plan.audit).toHaveLength(1);
          expect(plan.audit[0]?.ok).toBe(true);
          expect(plan.audit[0]?.observed.to).toBe(tip);
          const sim = yield* Update.simulate(plan);
          expect(sim.ok).toBe(true);
        }),
      );
    }),
  );

  it.effect("skipPlan omits impact; simulate still ok", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("skip");
      const node = Node.Service()("update/skip", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dummy = Node.Service()("update/skip-b", {
            path: "/tmp/skip-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });
          const plan = yield* Update.plan({
            steps: [
              {
                target: "ghost",
                successor: { node: dummy, process },
                tags: [Mail],
                skipPlan: true,
              },
            ],
          });
          expect(plan.steps[0]?.impact).toBeUndefined();
          expect(plan.blocked).toBe(false);
          expect(Update.isPlan(plan)).toBe(true);
          expect(Update.isPlan({ _tag: "Nope" })).toBe(false);
          const sim = yield* Update.simulate(plan);
          expect(sim.ok).toBe(true);
        }),
      );
    }),
  );

  it.effect("force collects blocked impact; simulate/execute refuse", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("force-blocked");
      const node = Node.Service()("update/force-blocked", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Service;
          yield* dir.advertise(
            new Directory.AdvertiseRequest({
              nodeKey: "jobs-force",
              kind: "IpcSocket",
              path: "/tmp/jobs-force.sock",
              serves: ["update-plan/Jobs"],
            }),
          );
          const dummy = Node.Service()("update/force-b", {
            path: "/tmp/force-b.sock",
          });
          const process = Launcher.command("true", [], { token: "env" });

          const plan = yield* Update.plan({
            force: true,
            steps: [
              {
                target: "jobs-force",
                successor: { node: dummy, process },
                tags: [jobsNext],
                incumbent: [Jobs],
              },
            ],
          });
          expect(plan.blocked).toBe(true);
          expect(plan.steps[0]?.impact?.blocked).toBe(true);

          const simExit = yield* Effect.exit(Update.simulate(plan));
          expectTaggedFailure(simExit, "UpdatePlanBlocked");

          // blocked short-circuits before spawn — still needs Launcher env typed.
          const execExit = yield* Effect.exit(
            Update.execute(plan).pipe(Effect.provide(Launcher.layer)),
          );
          expectTaggedFailure(execExit, "UpdatePlanBlocked");
        }),
      );
    }).pipe(Effect.provide(platform)),
  );

});

describe("Update.execute live A→B", () => {
  it.live(
    "plan → simulate → execute moves Directory dial (restart child)",
    () =>
      Effect.gen(function* () {
        yield* reapRestartChildren;
        const { root, entry } = restartChildEntryPaths();
        const lookupPath = yield* tmpSock("exec");
        const now = yield* Clock.currentTimeMillis;
        // pid salt avoids EADDRINUSE when this suite runs beside other live launchers.
        const portA = ephemeralPort(`${process.pid.toString(16)}${now.toString(16)}`, 241);
        const portB = ephemeralPort(`${process.pid.toString(16)}${now.toString(16)}`, 242);

        const lookupNode = Node.Service()("update/exec-lookup", {
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
              Directory.nodesServing(RestartJobs),
              (rows) =>
                rows.some(
                  (row) =>
                    row.nodeKey === "restart/worker" &&
                    row.url === `http://127.0.0.1:${String(portA)}/rpc`,
                ),
            );

            const plan = yield* Update.plan({
              steps: [
                {
                  target: "restart/worker",
                  successor: {
                    node: nodeB,
                    process: restartChildProcess(
                      root,
                      entry,
                      portB,
                      lookupPath,
                    ),
                    ready: { timeout: "25 seconds" },
                  },
                  tags: [RestartJobs],
                },
              ],
            });
            expect(plan.blocked).toBe(false);
            yield* Update.simulate(plan);
            yield* Update.execute(plan);

            yield* waitUntil(
              Directory.nodesServing(RestartJobs),
              (rows) =>
                rows.length === 1 &&
                rows[0]?.nodeKey === "restart/worker" &&
                rows[0]?.url === `http://127.0.0.1:${String(portB)}/rpc`,
            );

            const ping = yield* Effect.gen(function* () {
              const jobs = yield* RestartJobs;
              return yield* jobs.ping;
            }).pipe(
              Effect.provide(Hyperlink.client(RestartJobs, nodeB)),
              Effect.scoped,
            );
            expect(typeof ping).toBe("string");
          }).pipe(Effect.provide(Launcher.layer)),
        );
      }).pipe(Effect.provide(platform), Effect.scoped),
    { timeout: 60_000 },
  );
});
