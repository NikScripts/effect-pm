import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { WorkPool } from "../src";

// `.configure` is the toolkit successor to the old `WorkPool.define(...).configure(...)`:
// a config-patch *layer* (keyed by tag id) merged with the resource's layer, folded onto the base
// config at build. The consumer uses it for per-env concurrency / rateLimit overrides; here we
// patch an observable field (`paused`) to prove the fold happens.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class CfgQueue extends WorkPool.Service<CfgQueue>()("cfg/Q", { payload: NumberItem }) {}

it("WorkPool.configure folds onto the layer config (paused override wins)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* CfgQueue;
      // base config paused:false, configure patch paused:true → effective paused:true
      expect((yield* q.status.get).paused).toBe(true);
    }).pipe(
      Effect.provide(
        WorkPool.layerMemory(CfgQueue, {
          effect: (_item) => Effect.void,
          paused: false,
        }).pipe(
          Layer.provideMerge(WorkPool.configure(CfgQueue, { paused: true })),
        ),
      ),
      Effect.scoped,
    ),
  ));

it("without a configure patch the base config stands", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* CfgQueue;
      expect((yield* q.status.get).paused).toBe(false);
    }).pipe(
      Effect.provide(
        WorkPool.layerMemory(CfgQueue, {
          effect: (_item) => Effect.void,
          paused: false,
        }),
      ),
      Effect.scoped,
    ),
  ));
