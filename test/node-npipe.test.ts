import { Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import * as Lookup from "../src/Lookup";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

class JobsAnon extends Hyperlink.Tag<JobsAnon>()("npipe/JobsAnon", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("Node.nPipe", () => {
  it.effect("rejects non-win32 with NPipeRequiresWindows", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(
          Node.nPipe(Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) })),
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
      class HttpWorker extends Node.Tag<HttpWorker>()("npipe/HttpWorker", {
        url: "http://127.0.0.1:9",
        kind: "Http",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.nPipe(HttpWorker, [
            Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "NPipeListenRequiresIpc");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});

describe.skipIf(process.platform !== "win32")("Node.nPipe (win32)", () => {
  it.effect("nameless serve — named pipe + Lookup; discoverClient dials", () =>
    Effect.gen(function* () {
      const lookupPath = `\\\\.\\pipe\\hyperlink-ts-npipe-lookup-${process.pid}`;
      const serverCtx = yield* Layer.build(
        Node.nPipe(Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(5) })).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: false }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.discoverClient(JobsAnon, { lookupPath, unlink: false }),
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
