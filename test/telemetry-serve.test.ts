import { Duration, Effect, Layer, Metric, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Telemetry from "../src/Telemetry";

// Telemetry serves the whole per-process Metric registry. Emit a labeled counter, serve Telemetry over
// http, read `snapshot` via Resource.client — the counter round-trips with its label + count.

class FleetTelemetry extends Telemetry.Tag<FleetTelemetry>()() {}

const emitProbe = Effect.sync(() =>
  Metric.update(
    Metric.counter("test_telemetry_total", {
      incremental: true,
      description: "round-trip probe",
      attributes: { probe: "roster" },
    }),
    3,
  ),
).pipe(Effect.flatten);

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const Node = Resource.httpServer([
  Telemetry.serve(FleetTelemetry, { interval: Duration.millis(50) }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("serves the Metric registry — a labeled counter round-trips via snapshot over RPC", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* emitProbe;
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      const snap = yield* Effect.gen(function* () {
        const t = yield* FleetTelemetry;
        return yield* t.snapshot;
      }).pipe(
        Effect.provide(
          Resource.client(FleetTelemetry).pipe(Layer.provide(protocol(`${base}/rpc`))),
        ),
        Effect.scoped,
      );

      const probe = snap.metrics.find((m) => m.id === "test_telemetry_total");
      expect(probe?._tag).toBe("counter");
      if (probe?._tag === "counter") {
        expect(probe.count).toBe(3);
        expect(probe.labels.probe).toBe("roster");
      }
    }).pipe(Effect.provide(Node), Effect.scoped),
  ));

it("live streams sampled snapshots (in-process)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* emitProbe;
      const t = yield* FleetTelemetry;
      const first = yield* Stream.runHead(t.live);
      expect(first._tag).toBe("Some");
      if (first._tag === "Some") {
        expect(first.value.metrics.some((m) => m.id === "test_telemetry_total")).toBe(true);
      }
    }).pipe(
      Effect.provide(Telemetry.layer(FleetTelemetry, { interval: Duration.millis(20) })),
      Effect.scoped,
    ),
  ));
