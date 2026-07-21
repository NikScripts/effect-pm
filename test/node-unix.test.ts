import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-unix-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Resource.Tag<JobsAnon>()("unix/JobsAnon", {
  jobs: Resource.effect(Schema.Number),
}) {}

describe("Node.unix", () => {
  it.effect("Tag+impl — ipc listen + Lookup; client(Tag) dials", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("bound");
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>("unix/Worker", { path }) {}
      class Jobs extends Resource.Tag<Jobs>()("unix/Jobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Jobs, { jobs: Effect.succeed(11) }, {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(Resource.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — ipc + Lookup; clientLocal dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.unix(Resource.serve(JobsAnon, { jobs: Effect.succeed(5) }), {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(
        Resource.clientLocal(JobsAnon, { lookupPath, unlink: false }),
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
      class HttpWorker extends Node.Tag<HttpWorker>("unix/HttpWorker", {
        url: "http://127.0.0.1:9",
        kind: "Http",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.unix(HttpWorker, [
            Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "UnixListenRequiresIpc");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});
