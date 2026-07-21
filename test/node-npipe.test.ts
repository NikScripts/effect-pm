import { Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

class JobsAnon extends Resource.Tag<JobsAnon>()("npipe/JobsAnon", {
  jobs: Resource.effect(Schema.Number),
}) {}

describe("Node.nPipe", () => {
  it.effect("rejects non-win32 with NPipeRequiresWindows", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(
          Node.nPipe(Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }), {
            bootstrapLookup: false,
          }),
        ).pipe(Effect.scoped),
      );
      if (process.platform === "win32") {
        expect(
          Exit.isFailure(exit) &&
            String(exit.cause).includes("NPipeRequiresWindows"),
        ).toBe(false);
      } else {
        expectTaggedFailure(exit, "NPipeRequiresWindows");
        expect(Exit.isFailure(exit)).toBe(true);
      }
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("rejects Http Node with NPipeListenRequiresIpc", () =>
    Effect.gen(function* () {
      class HttpWorker extends Node.Tag<HttpWorker>("npipe/HttpWorker", {
        url: "http://127.0.0.1:9",
        kind: "Http",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.nPipe(HttpWorker, [
            Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "NPipeListenRequiresIpc");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});

describe.skipIf(process.platform !== "win32")("Node.nPipe (win32)", () => {
  it.effect("nameless serve — named pipe + Lookup; clientLocal dials", () =>
    Effect.gen(function* () {
      const lookupPath = `\\\\.\\pipe\\effect-pm-npipe-lookup-${process.pid}`;
      const serverCtx = yield* Layer.build(
        Node.nPipe(Resource.serve(JobsAnon, { jobs: Effect.succeed(5) }), {
          lookupPath,
          unlinkLookup: false,
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
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.kind).toBe("IpcSocket");
      expect(listenNode.path?.startsWith("\\\\.\\pipe\\")).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});
