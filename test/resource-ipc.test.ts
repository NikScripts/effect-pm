import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// Unix-domain RPC — Phase 1 ipc transport. Plain Resource.Tag (no Queue/Store).
// Build server Context first, then client — mergeAll races listen vs connect (SocketOpenError).

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-ipc-${label}-${process.pid}-${now}.sock`;
  });

class Echo extends Resource.Tag<Echo>()("ipc/Echo", {
  ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
}) {}

const echoImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 1),
};

/** Server listens before the ipc client dials. */
const withIpc = <A, E, R>(
  server: Layer.Layer<never, never, R>,
  client: Layer.Layer<Echo, Node.UnaddressedNode, never>,
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
    class Local extends Node.Tag<Local>("ipc/local", { path }) {}
    expect(Local.kind).toBe("IpcSocket");
    expect(Local.path).toBe(path);
    expect(Local.url).toBeUndefined();
  });

  it("honors explicit kind with path", () => {
    class Explicit extends Node.Tag<Explicit>("ipc/explicit", {
      path: "/tmp/x.sock",
      kind: "IpcSocket",
    }) {}
    expect(Explicit.kind).toBe("IpcSocket");
    expect(Explicit.path).toBe("/tmp/x.sock");
  });
});

describe("Node.ipcServer + connectIpc", () => {
  it("round-trips an RPC call over a Unix-domain socket", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("roundtrip");
        class Worker extends Node.Tag<Worker>("ipc/worker", { path }) {}

        const n = yield* withIpc(
          Node.ipcServer([Resource.serve(Echo, echoImpl)], { path }),
          Resource.client(Echo, Worker).pipe(
            Layer.provide(Worker.pipe(Node.connectIpc)),
          ),
          Effect.gen(function* () {
            const echo = yield* Echo;
            return yield* echo.ping({ n: 41 });
          }),
        );

        expect(n).toBe(42);
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));

  it("Node.connect derives ipc from the node's kind + path", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("derive");
        class Worker extends Node.Tag<Worker>("ipc/derive", { path }) {}

        const n = yield* withIpc(
          Node.ipcServer([Resource.serve(Echo, echoImpl)], { path }),
          Resource.client(Echo, Worker).pipe(
            Layer.provide(Node.connect(Worker)),
          ),
          Effect.gen(function* () {
            const echo = yield* Echo;
            return yield* echo.ping({ n: 1 });
          }),
        );

        expect(n).toBe(2);
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));

  it("unlinks so a second listen can bind the same path", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("stale");
        class Worker extends Node.Tag<Worker>("ipc/stale", { path }) {}

        const serve = () =>
          Node.ipcServer([Resource.serve(Echo, echoImpl)], { path });

        yield* Effect.void.pipe(Effect.provide(serve()), Effect.scoped);

        const n = yield* withIpc(
          serve(),
          Resource.client(Echo, Worker).pipe(
            Layer.provide(Node.connectIpc(Worker)),
          ),
          Effect.gen(function* () {
            const echo = yield* Echo;
            return yield* echo.ping({ n: 6 });
          }),
        );

        expect(n).toBe(7);
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));
});
