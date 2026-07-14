/**
 * Process.events over real HTTP RPC — Resource.client ∩ Process.serve.
 * Complements local `process-events.test.ts` and control-plane `process-remote-http.test.ts`.
 */
import { describe, expect, it } from "@effect/vitest";
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

/** Disarmed — subscribe to events, then drive with manual `run`. */
class RemoteEventsProc extends Process.Tag<RemoteEventsProc>()(
  "proc-remote-events/Ok",
).pipe(Process.schedule([])) {}

class RemoteFailProc extends Process.Tag<RemoteFailProc>()("proc-remote-events/Fail", {
  error: FetchErr,
}).pipe(Process.schedule([])) {}

class RemoteSuccessProc extends Process.Tag<RemoteSuccessProc>()(
  "proc-remote-events/Success",
  { success: Price },
).pipe(Process.schedule([])) {}

const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

/** Test harness — concrete Tags are not assignable under Process.serve's overloaded erasure. */
const withProcessHttp = (
  tag: any,
  config: Process.ProcessLayerConfig<any, any, any>,
  use: (port: number) => Effect.Effect<any, any, any>,
) => {
  const server = Resource.httpServer([Process.serve(tag, config)]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(Resource.client(tag).pipe(Layer.provide(clientHttp(port)))),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

describe("Process.events — remote HTTP", () => {
  it.live("Started → Completed over Resource.client after remote run", () =>
    withProcessHttp(RemoteEventsProc, { effect: Effect.void }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteEventsProc;
        const collected = yield* Effect.forkChild(
          Stream.runCollect(Stream.take(proc.events, 2)),
        );
        yield* Effect.sleep(Duration.millis(40));
        yield* proc.run;
        const tags = Array.from(yield* Fiber.join(collected)).map((e) => e._tag);
        expect(tags).toEqual(["Started", "Completed"]);
      }),
    ),
  );

  it.live("Failed carries stamped typed error on events over HTTP", () =>
    withProcessHttp(
      RemoteFailProc,
      { effect: Effect.fail({ _tag: "FetchError" as const, status: 503 }) },
      (_port) =>
        Effect.gen(function* () {
          const proc = yield* RemoteFailProc;
          const collected = yield* Effect.forkChild(
            Stream.runCollect(
              Stream.takeUntil(proc.events, (e) => e._tag === "Failed"),
            ),
          );
          yield* Effect.sleep(Duration.millis(40));
          const exit = yield* proc.run.pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
          const err = Option.getOrThrow(
            Cause.findErrorOption(
              Exit.isFailure(exit) ? exit.cause : Cause.die("expected failure"),
            ),
          );
          expect((err as { readonly _tag: string })._tag).toBe("FetchError");
          const events = Array.from(yield* Fiber.join(collected));
          expect(events.find((e) => e._tag === "Failed")).toMatchObject({
            _tag: "Failed",
            error: { _tag: "FetchError", status: 503 },
          });
        }),
    ),
  );

  it.live("Completed.success crosses the wire when the tag stamps success", () =>
    withProcessHttp(
      RemoteSuccessProc,
      { effect: Effect.succeed({ symbol: "AAPL", usd: 42 }) },
      (_port) =>
        Effect.gen(function* () {
          const proc = yield* RemoteSuccessProc;
          const collected = yield* Effect.forkChild(
            Stream.runCollect(
              Stream.takeUntil(proc.events, (e) => e._tag === "Completed"),
            ),
          );
          yield* Effect.sleep(Duration.millis(40));
          const result = yield* proc.run;
          expect(result).toEqual({ symbol: "AAPL", usd: 42 });
          const events = Array.from(yield* Fiber.join(collected));
          expect(events.find((e) => e._tag === "Completed")).toMatchObject({
            _tag: "Completed",
            success: { symbol: "AAPL", usd: 42 },
          });
        }),
    ),
  );
});
