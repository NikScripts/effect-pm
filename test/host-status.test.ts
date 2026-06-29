import { Effect, Layer, Option, Schema, Stream } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as HostStatus from "../src/HostStatus";
import { HostLogs } from "../src/HostLogs";
import { buildHostStatusImpl } from "../src/internal/hostStatusResource";

// A host serving one ordinary resource over `serveAllHttp` must ALSO auto-serve its host status
// (status / ping / logs / logHistory) without the author wiring anything — driven over real http.
class Echo extends Resource.Tag<Echo>()("hostStatus/Echo", {
  ping: Resource.query(Schema.String),
}) {}

const Server = Resource.serveAllHttp([
  { tag: Echo, impl: { ping: Effect.succeed("pong") } },
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

it("every served host auto-serves its host status over http", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      yield* Effect.gen(function* () {
        const host = yield* HostStatus.Tag;

        const snap = yield* host.statusNow;
        expect(snap.up).toBe(true);
        // the one user resource (Echo) — the host status itself is not counted
        expect(snap.resourceCount).toBe(1);
        expect(snap.uptimeMillis).toBeGreaterThanOrEqual(0);

        expect(typeof (yield* host.ping)).toBe("number");

        // the live status stream emits a first snapshot immediately
        const head = yield* Stream.runHead(host.status);
        expect(Option.isSome(head)).toBe(true);

        // no HistoryStore on the server → empty history (not an error)
        expect(yield* host.logHistory({ limit: 10 })).toEqual([]);
      }).pipe(
        Effect.provide(HostStatus.clientHttp(`http://127.0.0.1:${port}/rpc`)),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));

it("host status logs stream reflects the HostLogs relay when provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const impl = buildHostStatusImpl({ startedAt: 0, resourceCount: 0 });
      yield* Effect.logInfo("hello-host"); // captured by HostLogs.layer's merged logger
      const head = yield* Stream.runHead(
        impl.logs.pipe(Stream.filter((e) => e.message.includes("hello-host"))),
      );
      expect(Option.isSome(head)).toBe(true);
    }).pipe(Effect.provide(HostLogs.layer), Effect.scoped),
  ));
