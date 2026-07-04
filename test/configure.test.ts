import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { QueueResource } from "../src";

// `.configure` is the toolkit successor to the old `QueueResource.Service(...).configure(...)`:
// a config-patch *layer* (keyed by tag id) merged with the resource's layer, folded onto the base
// config at build. The consumer uses it for per-env concurrency / rateLimit overrides; here we
// patch an observable field (`paused`) to prove the fold happens.
const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}
class CfgQueue extends QueueResource.Tag<CfgQueue>()("cfg/Q", NumberItem) {}

it("QueueResource.configure folds onto the layer config (paused override wins)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* CfgQueue;
      // base config paused:false, configure patch paused:true → effective paused:true
      expect((yield* q.status.get).paused).toBe(true);
    }).pipe(
      Effect.provide(
        QueueResource.layer(CfgQueue, {
          effect: (_item) => Effect.void,
          paused: false,
        }).pipe(
          Layer.provideMerge(QueueResource.configure(CfgQueue, { paused: true })),
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
        QueueResource.layer(CfgQueue, {
          effect: (_item) => Effect.void,
          paused: false,
        }),
      ),
      Effect.scoped,
    ),
  ));
