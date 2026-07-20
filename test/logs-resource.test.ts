import { Duration, Effect, Fiber, Layer, Stream } from "effect";
import { expect, it } from "vitest";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as QueueResource from "../src/QueueResource";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { Schema } from "effect";
import { testBillingNodeKey } from "./fixtures/logKeys";
import * as Node from "../src/Node";

const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}

class LogQueue extends QueueResource.Tag<LogQueue>()("test/logs-resource/Q", {
  payload: NumberItem,
}) {}

class LogProc extends Process.Tag<LogProc>()("test/logs-resource/Proc").pipe(Process.schedule([])) {}

class EnvNode extends Node.Tag<EnvNode>(testBillingNodeKey) {}

class AppStore extends Store.Service<AppStore>("@test/logs-resource/Store")(
  EnvNode.logs,
  Process.store(LogProc),
  QueueResource.store(LogQueue),
) {}

it("Resource.logs surfaces queue worker lines on stream + query", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* LogQueue;
      const { stream, query } = yield* Resource.logs(LogQueue);
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(stream, (e) => e.message.includes("handling")),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* q.add({ n: 7 });
      const live = Array.from(yield* Fiber.join(collected))[0];
      expect(live?.message).toContain("handling 7");

      yield* Effect.gen(function* () {
        while ((yield* query({})).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));
      const rows = yield* query({ limit: 50 });
      expect(rows.some((r) => r.message.includes("handling 7"))).toBe(true);
    }).pipe(
      Effect.provide(
        // AppStore (Logs.layer + Storage) must build before auto-started queue workers fork.
        QueueResource.layer(LogQueue, {
          effect: (item) => Effect.logInfo(`handling ${String(item.n)}`),
          concurrency: 1,
        }).pipe(Layer.provideMerge(AppStore.layerMemory)),
      ),
      Effect.scoped,
    ),
  ));

it("Resource.logs surfaces process worker lines on query", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Resource.logs(LogProc);
      yield* proc.run;
      yield* Effect.gen(function* () {
        while ((yield* query({})).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));
      const rows = yield* query({ limit: 50 });
      expect(rows.some((r) => r.message.includes("process tick"))).toBe(true);
    }).pipe(
      Effect.provide(
        Process.layer(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provideMerge(AppStore.layerMemory)),
      ),
      Effect.scoped,
    ),
  ));

it("Resource.logs query is empty without store registration (live relay only)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const proc = yield* LogProc;
      const { query } = yield* Resource.logs(LogProc);
      expect(yield* query({})).toEqual([]);
      yield* proc.run;
      yield* Effect.sleep(Duration.millis(50));
      expect(yield* query({})).toEqual([]);
    }).pipe(
      Effect.provide(
        Process.layerMemory(LogProc, {
          effect: Effect.logInfo("process tick"),
        }).pipe(Layer.provide(Logs.layer)),
      ),
      Effect.scoped,
    ),
  ));
