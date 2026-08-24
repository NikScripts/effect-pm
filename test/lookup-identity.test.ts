import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Identity from "../src/Identity";
import * as Node from "../src/Node";
import * as Hyperlink from "../src/Hyperlink";

// L1 identity lookup over ipc — claim first-wins; OS bind exclusivity for default-local.
// Alive winners keep the key; dead/unreachable winners are replaceable (NodeStatus.ping).

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lookup-${label}-${process.pid}-${now}.sock`;
  });

/** Server Context first, then client — avoids listen/connect race. */
const withLookup = <A, E>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, Lookup.Services>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

class Jobs extends Hyperlink.Service<Jobs>()("lookup-id/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };

describe("LookupNode", () => {
  it("is a Node.Service with ipc from { path }", () => {
    const path = "/tmp/lookup-example.sock";
    const node = Node.Service()("lookup/example", { path }).pipe(Node.asLookup);
    expect(Node.isLookupNode(node)).toBe(true);
    expect(node.kind).toBe("IpcSocket");
    expect(node.path).toBe(path);
  });
});

describe("Lookup identity claim", () => {
  it.effect("first claim wins; live second gets DuplicateIdentity with original", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("claim");
      const winnerPath = yield* tmpSock("claim-winner");
      const lookupNode = Node.Service()("lookup/claim", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WinnerNode extends Node.Service<WinnerNode, Jobs>()(
        "lookup-id/Winner",
        { path: winnerPath },
      ) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      // Live process so NodeStatus.ping succeeds for the incumbent.
      const winnerCtx = yield* Layer.build(
        Node.unix(WinnerNode, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(
          Layer.provide(Lookup.client(lookupNode)),
        ),
      );

      const id = Context.get(lookupCtx, Identity.Service);
      const won = yield* id
        .claim(
          new Lookup.ClaimRequest({
            key: "app/Mail",
            nodeKey: WinnerNode.key,
            kind: "IpcSocket",
            path: winnerPath,
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(won.nodeKey).toBe(WinnerNode.key);
      expect(won.path).toBe(winnerPath);

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
          Effect.provide(lookupCtx),
        );

      expect(outcome._tag).toBe("dup");
      if (outcome._tag === "dup") {
        expect(outcome.duplicate.key).toBe("app/Mail");
        expect(outcome.duplicate.original.nodeKey).toBe(WinnerNode.key);
        expect(outcome.duplicate.original.path).toBe(winnerPath);
      }

      yield* Effect.sync(() => winnerCtx);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("same dial target refreshes without DuplicateIdentity", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("claim-refresh");
      const node = Node.Service()("lookup/claim-refresh", { path }).pipe(
        Node.asLookup,
      );

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const id = yield* Identity.Service;
          const req = new Lookup.ClaimRequest({
            key: "app/Mail",
            nodeKey: "worker-a",
            kind: "IpcSocket",
            path: "/tmp/worker-a.sock",
          });
          yield* id.claim(req);
          const again = yield* id.claim(req);
          expect(again.nodeKey).toBe("worker-a");
          expect(again.path).toBe("/tmp/worker-a.sock");
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  // Probe of a missing sock uses Effect.timeout(2s) — needs a live clock.
  it.live("dead / unreachable incumbent identity is replaced", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("claim-dead");
      const node = Node.Service()("lookup/claim-dead", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const id = yield* Identity.Service;
          yield* id.claim(
            new Lookup.ClaimRequest({
              key: "app/Mail",
              nodeKey: "worker-stale",
              kind: "IpcSocket",
              path: `/tmp/hyperlink-ts-lookup-id-missing-${process.pid}.sock`,
            }),
          );

          const replaced = yield* id.claim(
            new Lookup.ClaimRequest({
              key: "app/Mail",
              nodeKey: "worker-fresh",
              kind: "IpcSocket",
              path: "/tmp/worker-fresh.sock",
            }),
          );
          expect(replaced.nodeKey).toBe("worker-fresh");
          expect(replaced.path).toBe("/tmp/worker-fresh.sock");

          const resolved = yield* id.resolve(
            new Lookup.ResolveRequest({ key: "app/Mail" }),
          );
          expect(resolved._tag).toBe("Some");
          if (resolved._tag === "Some") {
            expect(resolved.value.nodeKey).toBe("worker-fresh");
          }
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(20))),
  );
});

describe("Lookup L1 bind exclusivity", () => {
  it.effect("second listen on the same path with unlink:false fails", () =>
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
  );
});

describe("Lookup.layerIpc (path override)", () => {
  it.effect("serves Identity on a chosen path (override default to avoid collisions)", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("default-local");
      yield* withLookup(
        Lookup.layerIpc(path),
        Lookup.clientOptions({ path }),
        Effect.gen(function* () {
          const id = yield* Identity.Service;
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
  );
});
