/**
 * Update.plan → simulate → execute — fleet order, contracts, blocked, live A→B.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Option,
  Schema,
  SchemaTransformation,
} from "effect";
import * as Advice from "../src/Advice";
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
import {
  advertiseIpc,
  dummySuccessor,
  tmpSock,
  waitUntil,
  withLookup,
  workPoolItemSchemaSym,
} from "./fixtures/updateHarness";

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

  it.effect("fails EmptyUpdateStepTags when a step has no tags", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("empty-tags");
      const node = Node.Service()("update/empty-tags", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("empty-tags");
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [{ target: "mail-a", successor, tags: [] }],
            }),
          );
          expectTaggedFailure(exit, "EmptyUpdateStepTags");
        }),
      );
    }),
  );

  it.effect("fails DuplicateUpdateTarget when targets collide", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("dup");
      const node = Node.Service()("update/dup", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("dup");
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                { target: "mail-a", successor, tags: [Mail] },
                { target: "mail-a", successor, tags: [Mail] },
              ],
            }),
          );
          expectTaggedFailure(exit, "DuplicateUpdateTarget");
        }),
      );
    }),
  );

  it.effect("fails EmptyUpdateTarget when target is whitespace", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("empty-target");
      const node = Node.Service()("update/empty-target", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("empty-target");
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [{ target: "   ", successor, tags: [Mail] }],
            }),
          );
          expectTaggedFailure(exit, "EmptyUpdateTarget");
        }),
      );
    }),
  );

  it.effect("fails EmptyUpdateTarget when target has leading/trailing space", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("trim-target");
      const node = Node.Service()("update/trim-target", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("trim-target");
          expectTaggedFailure(
            yield* Effect.exit(
              Update.plan({
                steps: [{ target: " mail-a ", successor, tags: [Mail] }],
              }),
            ),
            "EmptyUpdateTarget",
          );
        }),
      );
    }),
  );

  it.effect("fails EmptyUpdateTagKey when a tag key is blank", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("blank-key");
      const node = Node.Service()("update/blank-key", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("blank-key");
          const blank: Lookup.PlanUpdateTag = {
            key: "  ",
            [Hyperlink.wireKeySym]: "update-plan/Mail",
            [Hyperlink.specSym]: {
              ping: Hyperlink.effect(Schema.String),
            },
          };
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [{ target: "mail-a", successor, tags: [blank] }],
            }),
          );
          expectTaggedFailure(exit, "EmptyUpdateTagKey");
        }),
      );
    }),
  );

  it.effect("fails DuplicateUpdateContract when contracts collide", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("dup-contract");
      const node = Node.Service()("update/dup-contract", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-dup", "/tmp/vj-dup.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("dup-contract");
          const tip = Versioned.schemaVersion(JobChain);
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "vj-dup",
                  successor,
                  tags: [VersionedJobs],
                },
              ],
              contracts: [
                { tag: VersionedJobs, to: tip },
                { tag: VersionedJobs, to: tip },
              ],
            }),
          );
          expectTaggedFailure(exit, "DuplicateUpdateContract");
        }),
      );
    }),
  );

  it.effect("fails UpdateTargetUnknown when target is not advertised", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("unknown");
      const node = Node.Service()("update/unknown", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("unknown");
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                { target: "missing-worker", successor, tags: [Mail] },
              ],
            }),
          );
          expectTaggedFailure(exit, "UpdateTargetUnknown");
        }),
      );
    }),
  );

  it.effect("orders steps, attaches impacts, rolls up coUpdate", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("order");
      const node = Node.Service()("update/order", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("mail-a", "/tmp/mail-a.sock", [
            "update-plan/Mail",
          ]);
          yield* advertiseIpc("jobs-a", "/tmp/jobs-a.sock", [
            "update-plan/Jobs",
          ]);
          yield* advertiseIpc("jobs-b", "/tmp/jobs-b.sock", [
            "update-plan/Jobs",
          ]);

          const successor = dummySuccessor("order");
          const plan = yield* Update.plan({
            steps: [
              { target: "mail-a", successor, tags: [Mail] },
              { target: "jobs-a", successor, tags: [Jobs] },
            ],
          });

          expect(Update.isPlan(plan)).toBe(true);
          expect(plan.steps.map((s) => s.target)).toEqual(["mail-a", "jobs-a"]);
          expect(plan.steps[0]?.order).toBe(0);
          expect(plan.steps[1]?.order).toBe(1);
          expect(plan.steps[0]?.impact?.target).toBe("mail-a");
          expect(plan.steps[1]?.impact?.target).toBe("jobs-a");
          expect(plan.blocked).toBe(false);
          expect(plan.coUpdate).toEqual(["jobs-b"]);
          expect(plan.uncoveredCoUpdate).toEqual(["jobs-b"]);

          const sim = yield* Update.simulate(plan);
          expect(Update.isReport(sim)).toBe(true);
          expect(sim._tag).toBe("UpdateReport");
          expect(sim.plan._tag).toBe("UpdatePlan");
          expect(sim.audit).toEqual(plan.audit);

          const covered = yield* Update.plan({
            steps: [
              { target: "jobs-a", successor, tags: [Jobs] },
              { target: "jobs-b", successor, tags: [Jobs] },
            ],
          });
          expect(covered.coUpdate).toEqual(["jobs-a", "jobs-b"]);
          expect(covered.uncoveredCoUpdate).toEqual([]);
        }),
      );
    }),
  );

  it.effect("fails UpdateContractMismatch when successor tip ≠ contract.to", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract");
      const node = Node.Service()("update/contract", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-a", "/tmp/vj-a.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("contract");
          expect(Versioned.schemaVersion(JobChain)).toBe("update/job@2");

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "vj-a",
                  successor,
                  tags: [VersionedJobs],
                },
              ],
              contracts: [{ tag: VersionedJobs, to: "update/job@1" }],
            }),
          );
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.reason).toBe("To");
              expect(err.audit.length).toBeGreaterThan(0);
              expect(err.audit.some((row) => !row.ok)).toBe(true);
            }
          }
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
          yield* advertiseIpc("vj-ok", "/tmp/vj-ok.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("contract-ok");
          const tip = Versioned.schemaVersion(JobChain);

          const plan = yield* Update.plan({
            steps: [
              {
                target: "vj-ok",
                successor,
                tags: [VersionedJobs],
              },
            ],
            contracts: [{ tag: VersionedJobs, to: tip }],
          });
          expect(plan.blocked).toBe(false);
          expect(plan.audit).toHaveLength(1);
          expect(plan.audit[0]?.ok).toBe(true);
          expect(plan.audit[0]?.observed.to).toBe(tip);
          yield* Update.simulate(plan);
        }),
      );
    }),
  );

  it.effect("contract.from fails path when Versioned chain lacks from", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract-path");
      const node = Node.Service()("update/contract-path", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-path", "/tmp/vj-path.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("contract-path");
          const tip = Versioned.schemaVersion(JobChain);

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "vj-path",
                  successor,
                  tags: [VersionedJobs],
                },
              ],
              contracts: [
                {
                  tag: VersionedJobs,
                  from: "update/job@99",
                  to: tip,
                },
              ],
            }),
          );
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.reason).toBe("Path");
            }
          }
        }),
      );
    }),
  );

  it.effect("contract.from alone fails closed when nothing observed", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract-from-only");
      const node = Node.Service()("update/contract-from-only", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-from", "/tmp/vj-from.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("contract-from-only");

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "vj-from",
                  successor,
                  tags: [VersionedJobs],
                },
              ],
              // status off → no liveTips; from alone must fail closed
              contracts: [{ tag: VersionedJobs, from: "update/job@1" }],
            }),
          );
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.reason).toBe("From");
            }
          }
        }),
      );
    }),
  );

  it.effect("contract.from→to ok when Versioned path exists (status off)", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("contract-path-ok");
      const node = Node.Service()("update/contract-path-ok", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-path-ok", "/tmp/vj-path-ok.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("contract-path-ok");
          const tip = Versioned.schemaVersion(JobChain);

          const plan = yield* Update.plan({
            steps: [
              {
                target: "vj-path-ok",
                successor,
                tags: [VersionedJobs],
              },
            ],
            contracts: [
              {
                tag: VersionedJobs,
                from: "update/job@1",
                to: tip,
              },
            ],
          });
          expect(plan.blocked).toBe(false);
          expect(plan.audit[0]?.ok).toBe(true);
          expect(plan.audit[0]?.observed.from).toBeUndefined();
          expect(plan.audit[0]?.observed.to).toBe(tip);
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
          yield* advertiseIpc("jobs-a", "/tmp/jobs-blocked.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("blocked");

          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                {
                  target: "jobs-a",
                  successor,
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

  it.effect("skipPlan omits impact; simulate still ok", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("skip");
      const node = Node.Service()("update/skip", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("skip");
          const plan = yield* Update.plan({
            steps: [
              {
                target: "ghost",
                successor,
                tags: [Mail],
                skipPlan: true,
              },
            ],
          });
          expect(plan.steps[0]?.impact).toBeUndefined();
          expect(plan.blocked).toBe(false);
          expect(plan.coUpdate).toEqual([]);
          expect(Update.isPlan(plan)).toBe(true);
          expect(Update.isPlan({ _tag: "Nope" })).toBe(false);
          expect(
            Update.isPlan({
              _tag: "UpdatePlan",
              steps: [],
            }),
          ).toBe(false);
          yield* Update.simulate(plan);
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
          yield* advertiseIpc("jobs-force", "/tmp/jobs-force.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("force");

          const plan = yield* Update.plan({
            force: true,
            steps: [
              {
                target: "jobs-force",
                successor,
                tags: [jobsNext],
                incumbent: [Jobs],
              },
            ],
          });
          expect(plan.blocked).toBe(true);
          expect(plan.steps[0]?.impact?.blocked).toBe(true);
          expect(plan.steps[0]?.impact?.liveTips).toEqual([]);

          const simExit = yield* Effect.exit(Update.simulate(plan));
          expectTaggedFailure(simExit, "UpdatePlanBlocked");

          const execExit = yield* Effect.exit(
            Update.execute(plan).pipe(Effect.provide(Launcher.layer)),
          );
          expectTaggedFailure(execExit, "UpdatePlanBlocked");
        }),
      );
    }).pipe(Effect.provide(platform)),
  );

  it.effect("execute refuses a forged plan with blocked:false flag only", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("forged");
      const node = Node.Service()("update/forged", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("jobs-forge", "/tmp/jobs-forge.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("forged");
          const real = yield* Update.plan({
            force: true,
            steps: [
              {
                target: "jobs-forge",
                successor,
                tags: [jobsNext],
                incumbent: [Jobs],
              },
            ],
          });
          // Lie about plan.blocked — execute must re-validate from impacts.
          const forged: Update.Plan = { ...real, blocked: false };
          const exit = yield* Effect.exit(
            Update.execute(forged).pipe(Effect.provide(Launcher.layer)),
          );
          expectTaggedFailure(exit, "UpdatePlanBlocked");
        }),
      );
    }).pipe(Effect.provide(platform)),
  );

  it.effect("simulate refuses forged impact.blocked:false when arrays block", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("forged-arrays");
      const node = Node.Service()("update/forged-arrays", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("jobs-arrays", "/tmp/jobs-arrays.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("forged-arrays");
          const real = yield* Update.plan({
            force: true,
            steps: [
              {
                target: "jobs-arrays",
                successor,
                tags: [jobsNext],
                incumbent: [Jobs],
              },
            ],
          });
          const impact = real.steps[0]?.impact;
          expect(impact).toBeDefined();
          if (impact === undefined) return;
          // Forge both plan.blocked and impact.blocked — arrays still win.
          const forged: Update.Plan = {
            ...real,
            blocked: false,
            steps: [
              {
                ...real.steps[0]!,
                impact: { ...impact, blocked: false },
              },
            ],
          };
          const exit = yield* Effect.exit(Update.simulate(forged));
          expectTaggedFailure(exit, "UpdatePlanBlocked");
        }),
      );
    }),
  );

  it.effect("simulate re-validates forged empty tags / duplicate targets", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("forged-shape");
      const node = Node.Service()("update/forged-shape", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("mail-shape", "/tmp/mail-shape.sock", [
            "update-plan/Mail",
          ]);
          const successor = dummySuccessor("forged-shape");
          const real = yield* Update.plan({
            steps: [{ target: "mail-shape", successor, tags: [Mail] }],
          });
          const emptyTags: Update.Plan = {
            ...real,
            steps: [{ ...real.steps[0]!, tags: [] }],
          };
          expectTaggedFailure(
            yield* Effect.exit(Update.simulate(emptyTags)),
            "EmptyUpdateStepTags",
          );

          const dupTargets: Update.Plan = {
            ...real,
            steps: [
              { ...real.steps[0]!, order: 0 },
              { ...real.steps[0]!, order: 1 },
            ],
          };
          expectTaggedFailure(
            yield* Effect.exit(Update.simulate(dupTargets)),
            "DuplicateUpdateTarget",
          );
        }),
      );
    }),
  );

  it.effect("ambient Lookup.planForce collects blocked impact", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("ambient-force");
      const node = Node.Service()("update/ambient-force", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("jobs-ambient", "/tmp/jobs-ambient.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("ambient-force");
          const plan = yield* Update.plan({
            steps: [
              {
                target: "jobs-ambient",
                successor,
                tags: [jobsNext],
                incumbent: [Jobs],
              },
            ],
          }).pipe(Effect.provide(Lookup.planForce));
          expect(plan.blocked).toBe(true);
          expect(plan.steps[0]?.impact?.wireRemovals.length).toBeGreaterThan(0);
          expectTaggedFailure(
            yield* Effect.exit(Update.simulate(plan)),
            "UpdatePlanBlocked",
          );
        }),
      );
    }),
  );

  it.effect("contract.from mismatches observed liveTips (status on path)", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("live-tips-from");
      const node = Node.Service()("update/live-tips-from", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("vj-live", "/tmp/vj-live.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("live-tips-from");
          const tip = Versioned.schemaVersion(JobChain);
          const real = yield* Update.plan({
            steps: [
              {
                target: "vj-live",
                successor,
                tags: [VersionedJobs],
                skipPlan: true,
              },
            ],
          });
          // Synthesize status-on liveTips on the target — gate must honor From.
          const forged: Update.Plan = {
            ...real,
            contracts: [
              {
                tag: VersionedJobs,
                from: "update/job@1",
                to: tip,
              },
            ],
            steps: [
              {
                ...real.steps[0]!,
                impact: {
                  target: "vj-live",
                  served: ["update-plan/VersionedJobs"],
                  coUpdate: [],
                  clientsAtRisk: [],
                  migrationGaps: [],
                  wireRemovals: [],
                  contractDrifts: [],
                  liveTips: [
                    {
                      node: "vj-live",
                      serviceKey: "update-plan/VersionedJobs",
                      schemaVersion: "update/job@2",
                    },
                  ],
                  lookupFirst: false,
                  blocked: false,
                },
              },
            ],
          };
          const exit = yield* Effect.exit(Update.simulate(forged));
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.reason).toBe("From");
              expect(err.observed.from).toBe("update/job@2");
            }
          }
        }),
      );
    }),
  );

  it.effect("multi-contract mismatch carries full audit", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("multi-contract");
      const node = Node.Service()("update/multi-contract", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("mail-mc", "/tmp/mail-mc.sock", [
            "update-plan/Mail",
          ]);
          yield* advertiseIpc("vj-mc", "/tmp/vj-mc.sock", [
            "update-plan/VersionedJobs",
          ]);
          const successor = dummySuccessor("multi-contract");
          const tip = Versioned.schemaVersion(JobChain);
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [
                { target: "mail-mc", successor, tags: [Mail] },
                { target: "vj-mc", successor, tags: [VersionedJobs] },
              ],
              contracts: [
                { tag: Mail, to: "not-a-tip" },
                { tag: VersionedJobs, to: tip },
              ],
            }),
          );
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.serviceKey).toBe(Mail.key);
              expect(err.reason).toBe("To");
              expect(err.audit).toHaveLength(2);
              expect(err.audit[0]?.ok).toBe(false);
              expect(err.audit[1]?.ok).toBe(true);
            }
          }
        }),
      );
    }),
  );

  it.effect("simulate refuses forged empty steps", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("forged-empty");
      const node = Node.Service()("update/forged-empty", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("mail-empty", "/tmp/mail-empty.sock", [
            "update-plan/Mail",
          ]);
          const successor = dummySuccessor("forged-empty");
          const real = yield* Update.plan({
            steps: [{ target: "mail-empty", successor, tags: [Mail] }],
          });
          const forged: Update.Plan = { ...real, steps: [] };
          expectTaggedFailure(
            yield* Effect.exit(Update.simulate(forged)),
            "EmptyUpdatePlan",
          );
        }),
      );
    }),
  );

  it.effect("step.force overrides Input.force false", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("step-force");
      const node = Node.Service()("update/step-force", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("jobs-sf", "/tmp/jobs-sf.sock", [
            "update-plan/Jobs",
          ]);
          const successor = dummySuccessor("step-force");
          const plan = yield* Update.plan({
            force: false,
            steps: [
              {
                target: "jobs-sf",
                successor,
                tags: [jobsNext],
                incumbent: [Jobs],
                force: true,
              },
            ],
          });
          expect(plan.blocked).toBe(true);
          expect(plan.steps[0]?.force).toBe(true);
        }),
      );
    }),
  );

  it.effect("fails DuplicateUpdateTag when a step lists a key twice", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("dup-tag");
      const node = Node.Service()("update/dup-tag", { path }).pipe(Node.asLookup);
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const successor = dummySuccessor("dup-tag");
          expectTaggedFailure(
            yield* Effect.exit(
              Update.plan({
                steps: [
                  {
                    target: "mail-dup-tag",
                    successor,
                    tags: [Mail, Mail],
                  },
                ],
              }),
            ),
            "DuplicateUpdateTag",
          );
        }),
      );
    }),
  );

  it.effect("Input.prefer lands on PlannedStep", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("input-prefer");
      const node = Node.Service()("update/input-prefer", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("mail-pref", "/tmp/mail-pref.sock", [
            "update-plan/Mail",
          ]);
          const successor = dummySuccessor("input-prefer");
          const plan = yield* Update.plan({
            prefer: false,
            steps: [{ target: "mail-pref", successor, tags: [Mail] }],
          });
          expect(plan.steps[0]?.prefer).toBe(false);
          expect(plan.lookupFirst).toEqual([]);
        }),
      );
    }),
  );

  it.effect("contract.from+to fails closed when tag is not Versioned", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("non-versioned-path");
      const node = Node.Service()("update/non-versioned-path", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          yield* advertiseIpc("plain-nv", "/tmp/plain-nv.sock", [
            "update-plan/PlainJobs",
          ]);
          const successor = dummySuccessor("non-versioned-path");
          // Tip matches `to`, but item schema is not a Versioned chain — no path check.
          const PlainJobs = Object.assign(
            {
              key: "update-plan/PlainJobs",
              [Hyperlink.wireKeySym]: "update-plan/PlainJobs",
              [Hyperlink.specSym]: {
                run: Hyperlink.effect(Schema.Number),
              },
            } satisfies Lookup.PlanUpdateTag,
            { [workPoolItemSchemaSym]: JobV2 },
          );
          const tip = Versioned.schemaVersion(JobV2);
          const exit = yield* Effect.exit(
            Update.plan({
              steps: [{ target: "plain-nv", successor, tags: [PlainJobs] }],
              contracts: [
                { tag: PlainJobs, from: "update/job@1", to: tip },
              ],
            }),
          );
          expectTaggedFailure(exit, "UpdateContractMismatch");
          if (Exit.isFailure(exit)) {
            const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
            expect(err).toBeInstanceOf(Update.UpdateContractMismatch);
            if (err instanceof Update.UpdateContractMismatch) {
              expect(err.reason).toBe("From");
            }
          }
        }),
      );
    }),
  );

  it.effect("plan resolves target via a later tag (not only tags[0])", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("later-tag");
      const node = Node.Service()("update/later-tag", { path }).pipe(
        Node.asLookup,
      );
      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          // Advertised under Mail only — first tag key is absent.
          yield* advertiseIpc("mail-later", "/tmp/mail-later.sock", [
            "update-plan/Mail",
          ]);
          const successor = dummySuccessor("later-tag");
          const absent: Lookup.PlanUpdateTag = {
            key: "update-plan/Absent",
            [Hyperlink.wireKeySym]: "update-plan/Absent",
            [Hyperlink.specSym]: {
              ping: Hyperlink.effect(Schema.String),
            },
          };
          const plan = yield* Update.plan({
            steps: [
              {
                target: "mail-later",
                successor,
                tags: [absent, Mail],
              },
            ],
          });
          expect(plan.blocked).toBe(false);
          expect(plan.steps[0]?.impact?.target).toBe("mail-later");
        }),
      );
    }),
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
        const portA = ephemeralPort(
          `${process.pid.toString(16)}${now.toString(16)}`,
          241,
        );
        const portB = ephemeralPort(
          `${process.pid.toString(16)}${now.toString(16)}`,
          242,
        );

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
            expect(plan.uncoveredCoUpdate).toEqual([]);
            yield* Update.simulate(plan);
            const impacts = yield* Update.execute(plan);
            expect(impacts).toHaveLength(1);
            expect(impacts[0]?.target).toBe("restart/worker");

            // Default prefer:true stamps Advice → successor while dual-serving.
            const preferred = yield* Advice.preferred(RestartJobs.key);
            expect(Option.isSome(preferred)).toBe(true);
            if (Option.isSome(preferred)) {
              expect(preferred.value).toBe(nodeB.key);
            }

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

  it.live(
    "prefer:false skips Advice.prefer stamp after up(B)",
    () =>
      Effect.gen(function* () {
        yield* reapRestartChildren;
        const { root, entry } = restartChildEntryPaths();
        const lookupPath = yield* tmpSock("prefer-off");
        const now = yield* Clock.currentTimeMillis;
        const portA = ephemeralPort(
          `${process.pid.toString(16)}${now.toString(16)}`,
          251,
        );
        const portB = ephemeralPort(
          `${process.pid.toString(16)}${now.toString(16)}`,
          252,
        );

        const lookupNode = Node.Service()("update/prefer-lookup", {
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

            // Clear any prior prefer so the assertion is about execute.
            yield* Advice.clear(RestartJobs.key);

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
                  prefer: false,
                },
              ],
            });
            yield* Update.execute(plan);

            const preferred = yield* Advice.preferred(RestartJobs.key);
            expect(Option.isNone(preferred)).toBe(true);

            yield* waitUntil(
              Directory.nodesServing(RestartJobs),
              (rows) =>
                rows.length === 1 &&
                rows[0]?.url === `http://127.0.0.1:${String(portB)}/rpc`,
            );
          }).pipe(Effect.provide(Launcher.layer)),
        );
      }).pipe(Effect.provide(platform), Effect.scoped),
    { timeout: 60_000 },
  );
});
