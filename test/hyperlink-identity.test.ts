import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Identity from "../src/Identity";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// S1 — identity-stamped Tags claim at Lookup; winner serves, loser becomes client.
// Claim endpoint = ListenNode (listen) or Tag-bound Node — no `{ self }` bag.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-identity-${label}-${process.pid}-${now}.sock`;
  });

class Mail extends Hyperlink.Service<Mail>()("identity/Mail", {
  ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
}).pipe(Hyperlink.identity) {}

const mailImpl = {
  ping: ({ n }: { readonly n: number }) => Effect.succeed(n + 10),
};

describe("Hyperlink.identity", () => {
  it("stamps the handle", () => {
    expect(Hyperlink.isIdentity(Mail)).toBe(true);
  });

  it("IdentitySelfRequired message points at Lookup + dialable self", () => {
    const err = new Hyperlink.IdentitySelfRequired({ tag: "app/Mail" });
    expect(err.message).toContain("Identity.Service");
    expect(err.message).toContain("dialable self");
    expect(err.message).toContain("Lookup.layer");
  });

  it("rejects multi-node distributed on an identity Tag (S1)", () => {
    class A extends Node.Service<A>()("identity/multi-a", {
      path: "/tmp/identity-multi-a.sock",
    }) {}
    class B extends Node.Service<B>()("identity/multi-b", {
      path: "/tmp/identity-multi-b.sock",
    }) {}
    class Solo extends Hyperlink.Service<Solo>()("identity/Solo", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.identity) {}

    expect(() => Solo.pipe(Hyperlink.nodes([A, B]))).toThrow(
      Hyperlink.IdentityMultiNode,
    );

    class Fleet extends Hyperlink.Service<Fleet>()("identity/Fleet", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.nodes([A, B])) {}

    expect(() => Fleet.pipe(Hyperlink.identity)).toThrow(
      Hyperlink.IdentityMultiNode,
    );
  });

  it("allows a single-node fleet overwrite on identity", () => {
    class One extends Node.Service<One>()("identity/one", {
      path: "/tmp/identity-one.sock",
    }) {}
    class Solo extends Hyperlink.Service<Solo>()("identity/SoloOne", {
      ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Hyperlink.identity) {}

    const stamped = Solo.pipe(Hyperlink.nodes([One]));
    expect(Hyperlink.isIdentity(stamped)).toBe(true);
    expect(Hyperlink.distributedOf(stamped)).toHaveLength(1);
  });

  it.effect("fails closed without a dialable bound Node or ListenNode", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("noself-lookup");
      const lookupNode = Node.Service()("identity/noself-lookup", { path }).pipe(Node.asLookup);

      const exit = yield* Effect.exit(
        Layer.build(
          Hyperlink.layer(Mail, mailImpl).pipe(
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

      const lookupNode = Node.Service()("identity/claim-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      class WinnerNode extends Node.Service<WinnerNode>()("identity/winner", {
        path: winnerPath,
      }) {}
      class LoserNode extends Node.Service<LoserNode>()("identity/loser", {
        path: "/tmp/identity-loser-unused.sock",
      }) {}

      const lookupClient = Lookup.client(lookupNode);

      // Winner: listen stamps ListenNode for identity claim
      const lookupCtx = yield* Layer.build(Lookup.layerNode(lookupNode));
      const winnerCtx = yield* Layer.build(
        Node.unix(WinnerNode, [Hyperlink.serve(Mail, mailImpl)]).pipe(Layer.provide(lookupClient)),
      );

      // Loser: Tag-bound Node is the claim endpoint (nodes mutates the handle in place)
      void Hyperlink.nodes(Mail, [LoserNode]);
      const loserCtx = yield* Layer.build(
        Hyperlink.layer(Mail, mailImpl).pipe(Layer.provide(lookupClient)),
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

      const lookupNode = Node.Service()("identity/reclaim-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      class WinnerNode extends Node.Service<WinnerNode>()("identity/reclaim-w", {
        path: winnerPath,
      }) {}
      class NextNode extends Node.Service<NextNode>()("identity/reclaim-n", {
        path: nextPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClientCtx = yield* Layer.build(lookupClient);
      const lookupCtx = Context.merge(lookupServer, lookupClientCtx);

      yield* Layer.build(
        Node.unix(WinnerNode, [Hyperlink.serve(Mail, mailImpl)]).pipe(
          Layer.provide(lookupClient),
        ),
      ).pipe(Effect.scoped);

      // Stale claim still at Lookup; next listen should replace and serve.
      const nextCtx = yield* Layer.build(
        Node.unix(NextNode, [Hyperlink.serve(Mail, mailImpl)]).pipe(
          Layer.provide(lookupClient),
        ),
      );

      const n = yield* Effect.gen(function* () {
        const mail = yield* Mail;
        return yield* mail.ping({ n: 3 });
      }).pipe(Effect.provide(Context.merge(lookupCtx, nextCtx)));

      expect(n).toBe(13);

      const id = Context.get(lookupCtx, Identity.Service);
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
