import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// S1 — identity-stamped Tags claim at Lookup; winner serves, loser becomes client.
// Claim endpoint = ListenNode (listen) or Tag-bound Node — no `{ self }` bag.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-identity-${label}-${process.pid}-${now}.sock`;
  });

class Mail extends Resource.Tag<Mail>()("identity/Mail", {
  ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
}).pipe(Resource.identity) {}

const mailImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 10),
};

describe("Resource.identity", () => {
  it("stamps the handle", () => {
    expect(Resource.isIdentity(Mail)).toBe(true);
  });

  it("IdentitySelfRequired message points at Lookup + dialable self", () => {
    const err = new Resource.IdentitySelfRequired({ tag: "app/Mail" });
    expect(err.message).toContain("Lookup.Identity");
    expect(err.message).toContain("dialable self");
    expect(err.message).toContain("Lookup.layer");
  });

  it("rejects multi-node distributed on an identity Tag (S1)", () => {
    class A extends Node.Tag<A>()("identity/multi-a", {
      path: "/tmp/identity-multi-a.sock",
    }) {}
    class B extends Node.Tag<B>()("identity/multi-b", {
      path: "/tmp/identity-multi-b.sock",
    }) {}
    class Solo extends Resource.Tag<Solo>()("identity/Solo", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.identity) {}

    expect(() => Solo.pipe(Resource.nodes([A, B]))).toThrow(
      Resource.IdentityMultiNode,
    );

    class Fleet extends Resource.Tag<Fleet>()("identity/Fleet", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.nodes([A, B])) {}

    expect(() => Fleet.pipe(Resource.identity)).toThrow(
      Resource.IdentityMultiNode,
    );
  });

  it("allows a single-node fleet overwrite on identity", () => {
    class One extends Node.Tag<One>()("identity/one", {
      path: "/tmp/identity-one.sock",
    }) {}
    class Solo extends Resource.Tag<Solo>()("identity/SoloOne", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.identity) {}

    const stamped = Solo.pipe(Resource.nodes([One]));
    expect(Resource.isIdentity(stamped)).toBe(true);
    expect(Resource.distributedOf(stamped)).toHaveLength(1);
  });

  it.effect("fails closed without a dialable bound Node or ListenNode", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("noself-lookup");
      const lookupNode = Node.Tag()("identity/noself-lookup", { path }).pipe(Node.asLookup);

      const exit = yield* Effect.exit(
        Layer.build(
          Resource.layer(Mail, mailImpl).pipe(
            Layer.provide(Lookup.client(lookupNode)),
          ),
        ).pipe(Effect.scoped),
      );

      expectTaggedFailure(exit, "IdentitySelfRequired");
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.effect("first claimant serves; second becomes a client of the winner", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("claim-lookup");
      const winnerPath = yield* tmpSock("claim-winner");

      const lookupNode = Node.Tag()("identity/claim-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      class WinnerNode extends Node.Tag<WinnerNode>()("identity/winner", {
        path: winnerPath,
      }) {}
      class LoserNode extends Node.Tag<LoserNode>()("identity/loser", {
        path: "/tmp/identity-loser-unused.sock",
      }) {}

      const lookupClient = Lookup.client(lookupNode);

      // Winner: listen stamps ListenNode for identity claim
      const lookupCtx = yield* Layer.build(Lookup.layerNode(lookupNode));
      const winnerCtx = yield* Layer.build(
        Node.unix(WinnerNode, [Resource.serve(Mail, mailImpl)]).pipe(Layer.provide(lookupClient)),
      );

      // Loser: Tag-bound Node is the claim endpoint (nodes mutates the handle in place)
      void Resource.nodes(Mail, [LoserNode]);
      const loserCtx = yield* Layer.build(
        Resource.layer(Mail, mailImpl).pipe(Layer.provide(lookupClient)),
      );

      const n = yield* Effect.gen(function* () {
        const mail = yield* Mail;
        return yield* mail.ping({ n: 7 });
      }).pipe(
        Effect.provide(
          Context.merge(lookupCtx, Context.merge(winnerCtx, loserCtx)),
        ),
      );

      expect(n).toBe(17);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  // Winner scope close leaves a stale claim; NodeStatus.ping must free the key.
  it.live("dead winner's identity key is reclaimable by the next claimant", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("reclaim-lookup");
      const winnerPath = yield* tmpSock("reclaim-winner");
      const nextPath = yield* tmpSock("reclaim-next");

      const lookupNode = Node.Tag()("identity/reclaim-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      class WinnerNode extends Node.Tag<WinnerNode>()("identity/reclaim-w", {
        path: winnerPath,
      }) {}
      class NextNode extends Node.Tag<NextNode>()("identity/reclaim-n", {
        path: nextPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClientCtx = yield* Layer.build(lookupClient);
      const lookupCtx = Context.merge(lookupServer, lookupClientCtx);

      yield* Layer.build(
        Node.unix(WinnerNode, [Resource.serve(Mail, mailImpl)]).pipe(
          Layer.provide(lookupClient),
        ),
      ).pipe(Effect.scoped);

      // Stale claim still at Lookup; next listen should replace and serve.
      const nextCtx = yield* Layer.build(
        Node.unix(NextNode, [Resource.serve(Mail, mailImpl)]).pipe(
          Layer.provide(lookupClient),
        ),
      );

      const n = yield* Effect.gen(function* () {
        const mail = yield* Mail;
        return yield* mail.ping({ n: 3 });
      }).pipe(Effect.provide(Context.merge(lookupCtx, nextCtx)));

      expect(n).toBe(13);

      const id = Context.get(lookupCtx, Lookup.Identity);
      const resolved = yield* id
        .resolve(new Lookup.ResolveRequest({ key: Mail.key }))
        .pipe(Effect.provide(lookupCtx));
      expect(resolved._tag).toBe("Some");
      if (resolved._tag === "Some") {
        expect(resolved.value.path).toBe(nextPath);
      }
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});
