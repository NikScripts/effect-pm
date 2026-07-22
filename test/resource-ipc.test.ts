import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// Unix-domain RPC — Phase 1 ipc transport. Plain Hyperlink.Tag (no Queue/Store).
// Build server Context first, then client — mergeAll races listen vs connect (SocketOpenError).

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-ipc-${label}-${process.pid}-${now}.sock`;
  });

class Echo extends Hyperlink.Tag<Echo>()("ipc/Echo", {
  ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
}) {}

const echoImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 1),
};

/** Server listens before the ipc client dials. */
const withIpc = <A, E, R, LE = never>(
  server: Layer.Layer<never, never, R>,
  // Auto-connect clients are `Layer.Layer<Echo>`; connectIpc may still surface `UnaddressedNode`.
  client: Layer.Layer<Echo, LE>,
  use: Effect.Effect<A, E, Echo>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

describe("Node ProtocolKind — ipc", () => {
  it("infers ipc from { path }, leaves url undefined", () => {
    const path = "/tmp/example.sock";
    class Local extends Node.Tag<Local>()("ipc/local", { path }) {}
    expect(Local.kind).toBe("IpcSocket");
    expect(Local.path).toBe(path);
    expect(Local.url).toBeUndefined();
  });

  it("honors explicit kind with path", () => {
    class Explicit extends Node.Tag<Explicit>()("ipc/explicit", {
      path: "/tmp/x.sock",
      kind: "IpcSocket",
    }) {}
    expect(Explicit.kind).toBe("IpcSocket");
    expect(Explicit.path).toBe("/tmp/x.sock");
  });
});

describe("Node.ipcServer + connectIpc", () => {
  it.live("round-trips an RPC call over a Unix-domain socket", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("roundtrip");
      class Worker extends Node.Tag<Worker>()("ipc/worker", { path }) {}

      const n = yield* withIpc(
        Node.ipcServer([Hyperlink.serve(Echo, echoImpl)], { path }),
        Hyperlink.client(Echo, Worker).pipe(
          Layer.provide(Worker.pipe(Node.connectIpc)),
        ),
        Effect.gen(function* () {
          const echo = yield* Echo;
          return yield* echo.ping({ n: 41 });
        }),
      );

      expect(n).toBe(42);
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.live("Node.connect derives ipc from the node's kind + path", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("derive");
      class Worker extends Node.Tag<Worker>()("ipc/derive", { path }) {}

      const n = yield* withIpc(
        Node.ipcServer([Hyperlink.serve(Echo, echoImpl)], { path }),
        // Addressed Worker — auto-connect; no Layer.provide(Node.connect(Worker)).
        Hyperlink.client(Echo, Worker),
        Effect.gen(function* () {
          const echo = yield* Echo;
          return yield* echo.ping({ n: 1 });
        }),
      );

      expect(n).toBe(2);
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.live("with unlink:true, a second listen can bind the same path", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("stale");
      class Worker extends Node.Tag<Worker>()("ipc/stale", { path }) {}

      const serve = () =>
        Node.ipcServer([Hyperlink.serve(Echo, echoImpl)], {
          path,
          unlink: true,
        });

      yield* Effect.void.pipe(Effect.provide(serve()), Effect.scoped);

      const n = yield* withIpc(
        serve(),
        Hyperlink.client(Echo, Worker).pipe(
          Layer.provide(Node.connectIpc(Worker)),
        ),
        Effect.gen(function* () {
          const echo = yield* Echo;
          return yield* echo.ping({ n: 6 });
        }),
      );

      expect(n).toBe(7);
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );
});
