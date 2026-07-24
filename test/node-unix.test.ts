import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import * as Lookup from "../src/Lookup";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-unix-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Hyperlink.Tag<JobsAnon>()("unix/JobsAnon", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("Node.unix", () => {
  it.live("Tag+impl — ipc listen + Lookup; client(Tag) dials", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("bound");
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>()("unix/Worker", { path }) {}
      class Jobs extends Hyperlink.Tag<Jobs>()("unix/Jobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }).pipe(Hyperlink.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Jobs, { jobs: Effect.succeed(11) }).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(Hyperlink.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — ipc + Lookup; Hyperlink.unix(tag) dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.unix(Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(5) })).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.unix(JobsAnon, { lookupPath, unlink: false }),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* JobsAnon;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(5);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("rejects Http Node with UnixListenRequiresIpc", () =>
    Effect.gen(function* () {
      class HttpWorker extends Node.Tag<HttpWorker>()("unix/HttpWorker", {
        url: "http://127.0.0.1:9",
        kind: "Http",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.unix(HttpWorker, [
            Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "UnixListenRequiresIpc");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});
