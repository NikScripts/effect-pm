import { Clock, Context, Duration, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import * as Lookup from "../src/Lookup";

// L1 identity lookup over ipc — claim first-wins; OS bind exclusivity for default-local.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-lookup-${label}-${process.pid}-${now}.sock`;
  });

/** Server Context first, then client — avoids listen/connect race. */
const withLookup = <A, E>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<
    Lookup.Identity | Lookup.Directory,
    Lookup.LookupUnaddressed
  >,
  use: Effect.Effect<A, E, Lookup.Identity | Lookup.Directory>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

describe("LookupNode", () => {
  it("is a Resource.Node with ipc from { path }", () => {
    const path = "/tmp/lookup-example.sock";
    const node = Lookup.LookupNode("lookup/example", { path });
    expect(Lookup.isLookupNode(node)).toBe(true);
    expect(node.kind).toBe("IpcSocket");
    expect(node.path).toBe(path);
  });
});

describe("Lookup identity claim", () => {
  it("first claim wins; second gets DuplicateIdentity with original", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("claim");
        const node = Lookup.LookupNode("lookup/claim", { path });

        yield* withLookup(
          Lookup.layer(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const id = yield* Lookup.Identity;
            const won = yield* id.claim(
              new Lookup.ClaimRequest({
                key: "app/Mail",
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
              }),
            );
            expect(won.nodeKey).toBe("worker-a");
            expect(won.path).toBe("/tmp/worker-a.sock");

            const outcome = yield* id
              .claim(
                new Lookup.ClaimRequest({
                  key: "app/Mail",
                  nodeKey: "worker-b",
                  kind: "IpcSocket",
                  path: "/tmp/worker-b.sock",
                }),
              )
              .pipe(
                Effect.map((endpoint) => ({ _tag: "won" as const, endpoint })),
                Effect.catchTag("DuplicateIdentity", (duplicate) =>
                  Effect.succeed({ _tag: "dup" as const, duplicate }),
                ),
              );

            expect(outcome._tag).toBe("dup");
            if (outcome._tag === "dup") {
              expect(outcome.duplicate.key).toBe("app/Mail");
              expect(outcome.duplicate.original.nodeKey).toBe("worker-a");
              expect(outcome.duplicate.original.path).toBe("/tmp/worker-a.sock");
            }
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));
});

describe("Lookup L1 bind exclusivity", () => {
  it("second listen on the same path with unlink:false fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("exclusive");

        yield* Effect.gen(function* () {
          const firstCtx = yield* Layer.build(
            Lookup.layerIpc(path, { unlink: false }),
          );

          const secondExit = yield* Effect.exit(
            Layer.build(Lookup.layerIpc(path, { unlink: false })).pipe(
              Effect.scoped,
            ),
          );

          expect(Exit.isFailure(secondExit)).toBe(true);
          // keep first listener alive until assertions finish
          yield* Effect.sync(() => firstCtx);
        }).pipe(Effect.scoped);
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));
});

describe("Lookup.layerDefaultLocal", () => {
  it("serves Identity on a chosen path (override default to avoid collisions)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("default-local");
        yield* withLookup(
          Lookup.layerDefaultLocal({ path }),
          Lookup.clientDefaultLocal({ path }),
          Effect.gen(function* () {
            const id = yield* Lookup.Identity;
            const won = yield* id.claim(
              new Lookup.ClaimRequest({
                key: "k",
                nodeKey: "n",
                kind: "IpcSocket",
                path: "/tmp/n.sock",
              }),
            );
            expect(won.nodeKey).toBe("n");
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));
});
