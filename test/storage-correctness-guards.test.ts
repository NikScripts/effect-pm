import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { TestClock } from "effect/testing";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as CustomQueueResource from "../src/CustomQueueResource";
import * as Process from "../src/Process";
import * as QueueResource from "../src/QueueResource";
import * as RunResource from "../src/RunResource";
import * as Store from "../src/Store";
import * as Polling from "../src/Polling";
import { builtInProcessStoreContract } from "../src/internal/store/processStoreSpec";
import * as Node from "../src/Node";

const jobSchema = Schema.Struct({ id: Schema.String });

class Exec extends Process.Tag<Exec>()("test/storage-correctness/Exec") {}

class Jobs extends QueueResource.Tag<Jobs>()("test/storage-correctness/Jobs", {
  payload: jobSchema,
}) {}

class CustomJobs extends CustomQueueResource.Tag<CustomJobs>()(
  "test/storage-correctness/CustomJobs",
  {
    payload: jobSchema,
    levelCount: 2,
    namedLevels: { interactive: 0, batch: 1 },
  },
) {}

class Gate extends RunResource.Tag<{ readonly _tag: "Gate" }>()(
  "test/storage-correctness/Gate",
  { payload: Schema.Number, success: Schema.Number },
) {}

class AppStore extends Store.Service<AppStore>("@test/storage-correctness/FileStore")(
  Store.register(Exec, builtInProcessStoreContract(Exec)),
) {}

const jobsRegistration = QueueResource.store(Jobs);
const customJobsRegistration = CustomQueueResource.store(CustomJobs);
const gateRegistration = RunResource.store(Gate);

class QueueStore extends Store.Service<QueueStore>("@test/storage-correctness/QueueStore")(
  jobsRegistration,
) {}

class CustomQueueStore extends Store.Service<CustomQueueStore>(
  "@test/storage-correctness/CustomQueueStore",
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

describe("storage correctness — Process soft-default + AppStore override", () => {
  it.effect("Process.layer alone soft-defaults Memory (R fulfilled, no AppStore)", () =>
    Effect.gen(function* () {
      const live = Process.layer(Exec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      });
      yield* Effect.gen(function* () {
        yield* Exec;
        yield* TestClock.adjust(Duration.millis(200));
        const store = yield* Store.resolveOrDie(Exec.key, builtInProcessStoreContract(Exec));
        const events = yield* store.events();
        expect(events.some((row) => row._tag === "Completed")).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );

  it.effect("Process.layer + Layer.provideMerge(AppStore.sqlite) persists across reconnect", () =>
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
          const live = Process.layer(Exec, {
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

  it.effect("sibling Layer.merge(Process.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
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
            Process.layer(Exec, {
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

  it.effect("Node-logs-only Soft override — engine scope unreadable on that AppStore", () =>
    Effect.gen(function* () {
      // Soft captures NodeOnly Storage. Exec is not registered → resolve fails (writes are
      // fail-soft on the engine fiber; the compose mistake is silent empty journals).
      const live = Process.layer(Exec, {
        effect: Effect.void,
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(NodeOnlyStore.layerMemory));
      yield* Effect.gen(function* () {
        yield* Exec;
        yield* TestClock.adjust(Duration.millis(200));
        const resolved = yield* Effect.exit(
          Store.resolve(Exec.key, builtInProcessStoreContract(Exec)),
        );
        expect(Exit.isFailure(resolved)).toBe(true);
      }).pipe(Effect.provide(live), Effect.scoped);
    }).pipe(Effect.provide(clock), Effect.scoped),
  );
});

describe("storage correctness — QueueResource Soft override parity", () => {
  it.live("QueueResource.layer + provideMerge(AppStore.sqlite) persists across reconnect", () =>
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
          const live = QueueResource.layer(Jobs, {
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

  it.live("sibling Layer.merge(QueueResource.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
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
            QueueResource.layer(Jobs, {
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

describe("storage correctness — RunResource Soft override parity", () => {
  it.effect("RunResource.layer + provideMerge(AppStore.sqlite) persists across reconnect", () =>
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
          const live = RunResource.layer(Gate, {
            effect: (n: number) => Effect.succeed(n * 2),
          }).pipe(Layer.provideMerge(RunStore.layer({ filename })));
          yield* Effect.gen(function* () {
            const gate = yield* Gate;
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

  it.effect("sibling Layer.merge(RunResource.layer, AppStore.sqlite) leaves the SQLite file empty", () =>
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
            RunResource.layer(Gate, {
              effect: (n: number) => Effect.succeed(n * 2),
            }),
            RunStore.layer({ filename }),
          );
          yield* Effect.gen(function* () {
            const gate = yield* Gate;
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

describe("storage correctness — CustomQueue Soft override parity", () => {
  it.live(
    "CustomQueueResource.layer + provideMerge(AppStore.sqlite) persists across reconnect",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const baseDir = path.join(tmpdir(), `storage-correctness-cq-${randomUUID()}`);
        const dir = yield* Effect.acquireRelease(
          fs.makeDirectory(baseDir, { recursive: true }).pipe(Effect.as(baseDir)),
          (d) => fs.remove(d, { recursive: true, force: true }).pipe(Effect.ignore),
        );
        const filename = path.join(dir, "custom-queue.db");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const live = CustomQueueResource.layer(CustomJobs, {
              levelCount: 2,
              namedLevels: { interactive: 0, batch: 1 },
              effect: () => Effect.void,
              autoStart: true,
            }).pipe(Layer.provideMerge(CustomQueueStore.layer({ filename })));
            yield* Effect.gen(function* () {
              const q = yield* CustomJobs;
              yield* q.add({ id: "c1" }, "interactive");
              const store = yield* CustomQueueStore;
              yield* waitFor(store.events(), "Completed");
              expect((yield* store.events()).some((row) => row._tag === "Completed")).toBe(
                true,
              );
            }).pipe(Effect.provide(live));
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const events = yield* (yield* CustomQueueStore).events();
            expect(events.some((row) => row._tag === "Completed")).toBe(true);
          }).pipe(Effect.provide(CustomQueueStore.layer({ filename }))),
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.live(
    "sibling Layer.merge(CustomQueueResource.layer, AppStore.sqlite) leaves the SQLite file empty",
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
        const filename = path.join(dir, "custom-queue.db");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const live = Layer.merge(
              CustomQueueResource.layer(CustomJobs, {
                levelCount: 2,
                namedLevels: { interactive: 0, batch: 1 },
                effect: () => Effect.void,
                autoStart: true,
              }),
              CustomQueueStore.layer({ filename }),
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
            const events = yield* (yield* CustomQueueStore).events();
            expect(events.length).toBe(0);
          }).pipe(Effect.provide(CustomQueueStore.layer({ filename }))),
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
