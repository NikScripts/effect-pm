import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Schema, SubscriptionRef } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import * as Process from "../src/Process";
import { forwardClient, groupOf, specOf } from "../src/Resource";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class FailingProc extends Process.Tag<FailingProc>()("@test/process-run-rpc/Failing", {
  error: FetchErr,
}) {}

class OkProc extends Process.Tag<OkProc>()("@test/process-run-rpc/Ok", {
  success: Schema.Number,
}) {}

class VoidProc extends Process.Tag<VoidProc>()("@test/process-run-rpc/Void") {}

describe("Process manual effect RPC", () => {
  it.effect("Process.make run returns captured success via resultRef", () =>
    Effect.gen(function* () {
      const resultRef = yield* SubscriptionRef.make<Option.Option<unknown>>(Option.none());
      const handle = Process.make("@test/process-run-rpc/direct", {
        effect: Effect.succeed(42).pipe(
          Effect.tap((value) => SubscriptionRef.set(resultRef, Option.some(value))),
          Effect.asVoid,
        ),
        _resultRef: resultRef,
      });
      const result = yield* handle.run();
      expect(result).toBe(42);
    }),
  );

  it.effect("local effect fails with typed error when worker fails", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const proc = yield* FailingProc;
        return yield* proc.effect.pipe(Effect.exit);
      }).pipe(
        Effect.provide(
          Process.layer(FailingProc, {
            effect: Effect.fail({ _tag: "FetchError" as const, status: 503 }),
          }),
        ),
        Effect.scoped,
      );
      if (!Exit.isFailure(exit)) {
        return yield* Effect.die("expected failure");
      }
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err) && (err.value as { _tag: string })._tag === "FetchError").toBe(true);
    }),
  );

  it("RpcTest round-trip propagates typed failure on effect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* RpcTest.makeClient(groupOf(FailingProc));
        const svc = forwardClient(rpc, specOf(FailingProc), FailingProc.groupId, FailingProc.key) as {
          readonly effect: Effect.Effect<unknown, { readonly _tag: "FetchError"; readonly status: number }>;
        };
        const exit = yield* svc.effect.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Process.serveRemote(FailingProc, {
            effect: Effect.fail({ _tag: "FetchError" as const, status: 503 }),
          }),
        ),
        Effect.scoped,
      ) as Effect.Effect<void, never, never>,
    ),
  );

  it.effect("local effect returns stamped success value", () =>
    Effect.gen(function* () {
      const proc = yield* OkProc;
      const result = yield* proc.effect;
      expect(result).toBe(42);
    }).pipe(
      Effect.provide(Process.layer(OkProc, { effect: Effect.succeed(42) })),
      Effect.scoped,
    ),
  );

  it("RpcTest round-trip completes void manual effect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* RpcTest.makeClient(groupOf(VoidProc));
        const svc = forwardClient(rpc, specOf(VoidProc), VoidProc.groupId, VoidProc.key) as {
          readonly effect: Effect.Effect<void, never>;
        };
        yield* svc.effect;
      }).pipe(
        Effect.provide(Process.serveRemote(VoidProc, { effect: Effect.void })),
        Effect.scoped,
      ) as Effect.Effect<void, never, never>,
    ),
  );
});
