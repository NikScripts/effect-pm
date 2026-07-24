import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { TestClock } from "effect/testing";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as Daemon from "../src/Daemon";
import * as WorkPool from "../src/WorkPool";
import * as Gate from "../src/Gate";
import * as Store from "../src/Store";
import * as Polling from "../src/Polling";
import { builtInDaemonStoreContract } from "../src/internal/store/daemonStoreSpec";
import * as Node from "../src/Node";

const jobSchema = Schema.Struct({ id: Schema.String });

class Exec extends Daemon.Tag<Exec>()("test/storage-correctness/Exec") {}

class Jobs extends WorkPool.Tag<Jobs>()("test/storage-correctness/Jobs", {
  payload: jobSchema,
}) {}

class CustomJobs extends WorkPool.priority<CustomJobs>()(
  "test/storage-correctness/CustomJobs",
  {
    payload: jobSchema,
    laneCount: 2,
    namedLanes: { interactive: 0, batch: 1 },
  },
) {}

class TestGate extends Gate.Tag<{ readonly _tag: "Gate" }>()(
  "test/storage-correctness/Gate",
  { payload: Schema.Number, success: Schema.Number },
) {}

class AppStore extends Store.Service<AppStore>("@test/storage-correctness/FileStore")(
  Store.register(Exec, builtInDaemonStoreContract(Exec)),
) {}

const jobsRegistration = WorkPool.store(Jobs);
const customJobsRegistration = WorkPool.store(CustomJobs);
const gateRegistration = Gate.store(TestGate);

class QueueStore extends Store.Service<QueueStore>("@test/storage-correctness/QueueStore")(
  jobsRegistration,
) {}

class PriorityStore extends Store.Service<PriorityStore>(
  "@test/storage-correctness/PriorityStore",
)(customJobsRegistration) {}

class RunStore extends Store.Service<RunStore>("@test/storage-correctness/RunStore")(
  gateRegistration,
) {}

class NodeOnly extends Node.Tag<NodeOnly>()("test/storage-correctness/node") {}
class NodeOnlyStore extends Store.Service<NodeOnlyStore>("@test/storage-correctness/NodeOnly")(
  NodeOnly.logs,
) {}

const clock = TestClock.layer();

const waitFor = (
  read: Effect.Effect<ReadonlyArray<{ readonly _tag: string }>>,
  tag: string,
) =>
  Effect.gen(function* () {
    while (!(yield* read).some((row) => row._tag === tag)) {
      yield* Effect.sleep(Duration.millis(20));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

describe("storage correctness — Daemon soft-default + AppStore override", () => {
  it.effect("Daemon.layer alone soft-defaults Memory (R fulfilled, no AppStore)", () =>
    Effect.gen(function* () {
      const live = Daemon.layer(Exec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      });
      yield* Effect.gen(function* () {
        yield* Exec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* Store.resolveOrDie(Exec.key, builtInDaemonStoreContract(Exec));
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("Daemon.layer + Layer.provideMerge(AppStore.sqlite) persists across reconnect", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "app.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Daemon.layer(Exec, {
            effect: Effect.void,
            polling: Polling.spaced(Duration.millis(50)),
          }).pipe(Layer.provideMerge(AppStore.layer({ filename })));
          yield* Effect.gen(function* () {
            yield* Exec;
            yield* TestClock.adjust(Duration.millis(200));
            const events = yield* (yield* AppStore).events();
            expect(events.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(Layer.mergeAll(live, clock)));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* AppStore).events();
          expect(events.some((row) => row._tag === "Completed")).toBe(true);
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, clock)), Effect.scoped),
  );

  it.effect("sibling Layer.merge(Daemon.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-footgun-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "app.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Layer.merge(
            Daemon.layer(Exec, {
              effect: Effect.void,
              polling: Polling.spaced(Duration.millis(50)),
            }),
            AppStore.layer({ filename }),
          );
          yield* Effect.gen(function* () {
            yield* Exec;
            yield* TestClock.adjust(Duration.millis(200));
          }).pipe(Effect.provide(Layer.mergeAll(live, clock)));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* AppStore).events();
          expect(events.length).toBe(0);
        }).pipe(Effect.provide(AppStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, clock)), Effect.scoped),
  );

  it.effect("Node-logs-only Soft override — layer build dies (fail-loud)", () =>
    Effect.gen(function* () {
      // Soft captures NodeOnly Storage. Exec is not registered → die at Daemon.layer build.
      const live = Daemon.layer(Exec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(NodeOnlyStore.layerMemory));
      const exit = yield* Effect.exit(Layer.build(live).pipe(Effect.scoped));
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("Queue Soft with Node-logs-only AppStore dies at layer build", () =>
    Effect.gen(function* () {
      const live = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Layer.provideMerge(NodeOnlyStore.layerMemory));
      const exit = yield* Effect.exit(Layer.build(live).pipe(Effect.scoped));
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("storage correctness — WorkPool Soft override parity", () => {
  it.live("WorkPool.layer + provideMerge(AppStore.sqlite) persists across reconnect", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-queue-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "queue.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = WorkPool.layer(Jobs, {
            effect: () => Effect.void,
            autoStart: true,
          }).pipe(Layer.provideMerge(QueueStore.layer({ filename })));
          yield* Effect.gen(function* () {
            const q = yield* Jobs;
            yield* q.add({ id: "j1" });
            const store = yield* QueueStore;
            yield* waitFor(store.events(), "Completed");
            expect((yield* store.events()).some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(live));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* QueueStore).events();
          expect(events.some((row) => row._tag === "Completed")).toBe(true);
        }).pipe(Effect.provide(QueueStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.live("sibling Layer.merge(WorkPool.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-queue-footgun-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "queue.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Layer.merge(
            WorkPool.layer(Jobs, {
              effect: () => Effect.void,
              autoStart: true,
            }),
            QueueStore.layer({ filename }),
          );
          yield* Effect.gen(function* () {
            const q = yield* Jobs;
            yield* q.add({ id: "j1" });
            yield* Effect.sleep(Duration.millis(200));
          }).pipe(Effect.provide(live));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const events = yield* (yield* QueueStore).events();
          expect(events.length).toBe(0);
        }).pipe(Effect.provide(QueueStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("storage correctness — Gate Soft override parity", () => {
  it.effect("Gate.layer + provideMerge(AppStore.sqlite) persists across reconnect", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-run-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "run.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Gate.layer(TestGate, {
            effect: (n: number) => Effect.succeed(n * 2),
          }).pipe(Layer.provideMerge(RunStore.layer({ filename })));
          yield* Effect.gen(function* () {
            const gate = yield* TestGate;
            yield* gate.run(21);
            const facts = yield* (yield* RunStore).facts();
            expect(facts.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(live));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const facts = yield* (yield* RunStore).facts();
          expect(facts.some((row) => row._tag === "Completed")).toBe(true);
        }).pipe(Effect.provide(RunStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("sibling Layer.merge(Gate.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const baseDir = path.join(tmpdir(), `storage-correctness-run-footgun-${randomUUID()}`);
      const dir = yield* Effect.acquireRelease(
        fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
        (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
      );
      const filename = path.join(dir, "run.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const live = Layer.merge(
            Gate.layer(TestGate, {
              effect: (n: number) => Effect.succeed(n * 2),
            }),
            RunStore.layer({ filename }),
          );
          yield* Effect.gen(function* () {
            const gate = yield* TestGate;
            yield* gate.run(21);
          }).pipe(Effect.provide(live));
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const facts = yield* (yield* RunStore).facts();
          expect(facts.length).toBe(0);
        }).pipe(Effect.provide(RunStore.layer({ filename }))),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("storage correctness — Priority Soft override parity", () => {
  it.live(
    "WorkPool.layer + provideMerge(AppStore.sqlite) persists across reconnect",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const baseDir = path.join(tmpdir(), `storage-correctness-cq-${randomUUID()}`);
        const dir = yield* Effect.acquireRelease(
          fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
          (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
        );
        const filename = path.join(dir, "priority-queue.db");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const live = WorkPool.layer(CustomJobs, {
              laneCount: 2,
              namedLanes: { interactive: 0, batch: 1 },
              effect: () => Effect.void,
              autoStart: true,
            }).pipe(Layer.provideMerge(PriorityStore.layer({ filename })));
            yield* Effect.gen(function* () {
              const q = yield* CustomJobs;
              yield* q.add({ id: "c1" }, "interactive");
              const store = yield* PriorityStore;
              yield* waitFor(store.events(), "Completed");
              expect((yield* store.events()).some((row) => row._tag === "Completed")).toBe(
                true,
              );
            }).pipe(Effect.provide(live));
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const events = yield* (yield* PriorityStore).events();
            expect(events.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(PriorityStore.layer({ filename }))),
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.live(
    "sibling Layer.merge(WorkPool.layer, AppStore.sqlite) leaves the SQLite file empty",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const baseDir = path.join(
          tmpdir(),
          `storage-correctness-cq-footgun-${randomUUID()}`,
        );
        const dir = yield* Effect.acquireRelease(
          fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
          (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
        );
        const filename = path.join(dir, "priority-queue.db");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const live = Layer.merge(
              WorkPool.layer(CustomJobs, {
                laneCount: 2,
                namedLanes: { interactive: 0, batch: 1 },
                effect: () => Effect.void,
                autoStart: true,
              }),
              PriorityStore.layer({ filename }),
            );
            yield* Effect.gen(function* () {
              const q = yield* CustomJobs;
              yield* q.add({ id: "c1" }, "interactive");
              yield* Effect.sleep(Duration.millis(200));
            }).pipe(Effect.provide(live));
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const events = yield* (yield* PriorityStore).events();
            expect(events.length).toBe(0);
          }).pipe(Effect.provide(PriorityStore.layer({ filename }))),
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
