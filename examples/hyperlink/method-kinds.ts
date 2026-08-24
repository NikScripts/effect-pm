/**
 * @module examples/hyperlink/method-kinds
 *
 * One Tag with the common method kinds: `effect`, `effectFn`, `ref`, and `stream`.
 *
 * ```bash
 * pnpm run example:hyperlink-method-kinds
 * ```
 */

// ---cut---
import { Effect, Schema, Stream, SubscriptionRef } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

class MethodKinds extends Hyperlink.Service<MethodKinds>()("examples/MethodKinds", {
  current: Hyperlink.effect(Schema.Number),
  add: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  value: Hyperlink.ref(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
}) {}

const MethodKindsLive = Hyperlink.layer(
  MethodKinds,
  Effect.gen(function* () {
    const value = yield* SubscriptionRef.make(0);
    return {
      current: SubscriptionRef.get(value),
      add: ({ by }: { readonly by: number }) =>
        SubscriptionRef.update(value, (n) => n + by).pipe(
          Effect.andThen(SubscriptionRef.get(value)),
        ),
      value: Hyperlink.subscribable(value),
      ticks: Stream.fromIterable([1, 2, 3]),
    };
  }),
);

const program = Effect.gen(function* () {
  const svc = yield* MethodKinds;

  const before = yield* svc.current;
  const after = yield* svc.add({ by: 5 });
  const live = yield* svc.value.get;
  const ticks = yield* svc.ticks.pipe(Stream.runCollect, Effect.map((chunk) => Array.from(chunk)));

  yield* Effect.logInfo(
    `effect=${String(before)} effectFn=${String(after)} ref=${String(live)} stream=${ticks.join(",")}`,
  );

  if (before !== 0 || after !== 5 || live !== 5 || ticks.join(",") !== "1,2,3") {
    return yield* Effect.die(new Error("unexpected method kind result"));
  }
}).pipe(Effect.provide(MethodKindsLive), Effect.scoped);

// ---cut-after---
await Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("example:hyperlink-method-kinds finished OK"))),
);
