import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Schema, SubscriptionRef } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import * as Daemon from "../src/Daemon";
import { forwardClient, groupOf, specOf } from "../src/Hyperlink";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class FailingProc extends Daemon.Tag<FailingProc>()("@test/daemon-run-rpc/Failing", {
  error: FetchErr,
}) {}

class OkProc extends Daemon.Tag<OkProc>()("@test/daemon-run-rpc/Ok", {
  success: Schema.Number,
}) {}

class VoidDaemon extends Daemon.Tag<VoidDaemon>()("@test/daemon-run-rpc/Void") {}

describe("Daemon manual run RPC", () => {
  it.effect("Daemon.make run returns captured success via resultRef", () =>
    Effect.gen(function* () {
      const resultRef = yield* SubscriptionRef.make<Option.Option<unknown>>(Option.none());
      const handle = Daemon.make("@test/daemon-run-rpc/direct", {
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

  it.effect("local run fails with typed error when worker fails", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const proc = yield* FailingProc;
        return yield* proc.run.pipe(Effect.exit);
      }).pipe(
        Effect.provide(
          Daemon.layerMemory(FailingProc, {
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

  it("RpcTest round-trip propagates typed failure on run", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* RpcTest.makeClient(groupOf(FailingProc));
        const svc = forwardClient(rpc, specOf(FailingProc), FailingProc.groupId, FailingProc.key) as {
          readonly run: Effect.Effect<unknown, { readonly _tag: "FetchError"; readonly status: number }>;
        };
        const exit = yield* svc.run.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Daemon.serveRemoteMemory(FailingProc, {
            effect: Effect.fail({ _tag: "FetchError" as const, status: 503 }),
          }),
        ),
        Effect.scoped,
        // RpcTest Handler stays in R from serveRemoteMemory; erase for runPromise.
      ) as Effect.Effect<void, never, never>,
    ),
  );

  it.effect("local run returns stamped success value", () =>
    Effect.gen(function* () {
      const proc = yield* OkProc;
      const result = yield* proc.run;
      expect(result).toBe(42);
    }).pipe(
      Effect.provide(Daemon.layerMemory(OkProc, { effect: Effect.succeed(42) })),
      Effect.scoped,
    ),
  );

  it("RpcTest round-trip completes void manual run", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* RpcTest.makeClient(groupOf(VoidDaemon));
        const svc = forwardClient(rpc, specOf(VoidDaemon), VoidDaemon.groupId, VoidDaemon.key) as {
          readonly run: Effect.Effect<void, never>;
        };
        yield* svc.run;
      }).pipe(
        Effect.provide(Daemon.serveRemoteMemory(VoidDaemon, { effect: Effect.void })),
        Effect.scoped,
        // RpcTest Handler stays in R from serveRemoteMemory; erase for runPromise.
      ) as Effect.Effect<void, never, never>,
    ),
  );
});
