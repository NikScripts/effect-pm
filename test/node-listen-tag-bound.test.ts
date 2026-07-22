import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-listen-tag-${label}-${process.pid}-${now}.sock`;
  });

const unixTagErased = Node.unix as unknown as (
  tag: Hyperlink.PipeableTag,
  impl: unknown,
  options?: Node.NamelessListenOptions,
) => Layer.Layer<never, Node.ListenTagNodeRequired | Node.UnixListenRequiresIpc>;

describe("Node.unix(Tag, impl) sole-bound node", () => {
  it.live("listens on the Tag's node; client(Tag) dials", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("bound");
      class Worker extends Node.Tag<Worker>()("listen-tag/Worker", { path }) {}
      class Jobs extends Hyperlink.Tag<Jobs>()("listen-tag/Jobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }).pipe(Hyperlink.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Jobs, { jobs: Effect.succeed(11) }),
      );
      const clientCtx = yield* Layer.build(Hyperlink.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("fails ListenTagNodeRequired when Tag has no Node", () =>
    Effect.gen(function* () {
      class Jobs extends Hyperlink.Tag<Jobs>()("listen-tag/MissingJobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }) {}

      const exit = yield* Effect.exit(
        Layer.build(
          unixTagErased(Jobs, { jobs: Effect.succeed(1) }),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenTagNodeRequired");
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("Node.listen on ipc Node fails ListenUseProtocol", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("use-unix");
      class Worker extends Node.Tag<Worker>()("listen-tag/UseUnix", { path }) {}
      class Jobs extends Hyperlink.Tag<Jobs>()("listen-tag/UseUnixJobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }) {}

      const exit = yield* Effect.exit(
        Layer.build(
          Node.listen(Worker, [
            Hyperlink.serve(Jobs, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenUseProtocol");
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});
