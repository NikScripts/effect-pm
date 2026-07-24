import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Ref, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import * as WorkPool from "../src/WorkPool";
import * as Hyperlink from "../src/Hyperlink";
import { flattenHyperlinkSpec } from "../src/Hyperlink";
import type { AnyMethod } from "../src/Hyperlink";
import {
  assertQueueInstanceSpec,
  QueueSpecShapeError,
} from "../src/internal/queueSpecAssert";
import * as Node from "../src/Node";

const jobSchema = Schema.Struct({ id: Schema.String });

class NumberQueue extends WorkPool.Tag<NumberQueue>()("@test/queue-spec-wire/Number", {
  payload: jobSchema,
  success: Schema.Number,
}) {}

const asRpcMethod = (m: unknown): AnyMethod | undefined =>
  m !== undefined && typeof m === "object" && m !== null && "kind" in m
    ? (m as AnyMethod)
    : undefined;

const httpProtocol = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

describe("queueSpec wire — structural validation", () => {
  it("wired spec keys and method kinds match erased baseline (only events schema differs)", () => {
    const wired = WorkPool.queueSpec(jobSchema, { success: Schema.Number });
    const baseline = WorkPool.queueSpec(jobSchema);
    const flatWired = flattenHyperlinkSpec(wired);
    const flatBaseline = flattenHyperlinkSpec(baseline);
    expect(Object.keys(flatWired).sort()).toEqual(Object.keys(flatBaseline).sort());
    for (const key of Object.keys(flatWired)) {
      if (key === "events") {
        expect(asRpcMethod(flatWired.events)?.stream).toBe(true);
        expect(asRpcMethod(flatBaseline.events)?.stream).toBe(true);
        continue;
      }
      const wiredMethod = asRpcMethod(flatWired[key]);
      const baselineMethod = asRpcMethod(flatBaseline[key]);
      expect(wiredMethod?.kind).toBe(baselineMethod?.kind);
      expect(wiredMethod?.stream).toBe(baselineMethod?.stream);
    }
    expect(() =>
      assertQueueInstanceSpec(wired, baseline, { success: Schema.Number }),
    ).not.toThrow();
  });

  it("rejects specs with extra keys", () => {
    const wired = {
      ...WorkPool.queueSpec(jobSchema),
      extra: WorkPool.queueSpec(jobSchema).add,
    };
    expect(() =>
      assertQueueInstanceSpec(wired, WorkPool.queueSpec(jobSchema)),
    ).toThrow(QueueSpecShapeError);
  });
});

describe("queueSpec wire — RPC round-trip", () => {
  const numberQueueServer = Node.httpServer([
    WorkPool.serveMemory(NumberQueue, {
      effect: (job) => Effect.succeed(job.id.length),
      concurrency: 1,
    }),
  ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

  it.live("Completed.success is a number over http RPC when tag stamps success", () =>
    Effect.gen(function* () {
      const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = address._tag === "TcpAddress" ? address.port : 0;

      yield* Effect.gen(function* () {
        const q = yield* NumberQueue;
        const successes = yield* Ref.make<ReadonlyArray<unknown>>([]);
        yield* Stream.runForEach(q.events, (e) =>
          e._tag === "Completed" && typeof e.success === "number"
            ? Ref.update(successes, (seen) => [...seen, e.success])
            : Effect.void,
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep(Duration.millis(20));
        yield* q.add({ id: "abcd" });
        yield* Effect.sleep(Duration.millis(120));
        const values = yield* Ref.get(successes);
        expect(values).toContain(4);
      }).pipe(
        Effect.provide(Hyperlink.client(NumberQueue).pipe(Layer.provide(httpProtocol(port)))),
        Effect.scoped,
      );
    }).pipe(Effect.provide(numberQueueServer), Effect.scoped),
  );
});
