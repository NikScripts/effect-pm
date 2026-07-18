import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";

// S1 — identity-stamped Tags claim at Lookup; winner serves, loser becomes client.

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

  it("rejects multi-node distributed on an identity Tag (S1)", () => {
    class A extends Resource.Node<A>("identity/multi-a", {
      path: "/tmp/identity-multi-a.sock",
    }) {}
    class B extends Resource.Node<B>("identity/multi-b", {
      path: "/tmp/identity-multi-b.sock",
    }) {}
    class Solo extends Resource.Tag<Solo>()("identity/Solo", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.identity) {}

    expect(() => Solo.pipe(Resource.distributed([A, B]))).toThrow(
      Resource.IdentityMultiNode,
    );

    class Fleet extends Resource.Tag<Fleet>()("identity/Fleet", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.distributed([A, B])) {}

    expect(() => Fleet.pipe(Resource.identity)).toThrow(
      Resource.IdentityMultiNode,
    );
  });

  it("allows a single-node fleet overwrite on identity", () => {
    class One extends Resource.Node<One>("identity/one", {
      path: "/tmp/identity-one.sock",
    }) {}
    class Solo extends Resource.Tag<Solo>()("identity/SoloOne", {
      ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
    }).pipe(Resource.identity) {}

    const stamped = Solo.pipe(Resource.distributed([One]));
    expect(Resource.isIdentity(stamped)).toBe(true);
    expect(Resource.distributedOf(stamped)).toHaveLength(1);
  });

  it("fails closed without a dialable self", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("noself-lookup");
        const lookupNode = Lookup.LookupNode("identity/noself-lookup", { path });

        const exit = yield* Effect.exit(
          Layer.build(
            Resource.layer(Mail, mailImpl).pipe(
              Layer.provide(Lookup.client(lookupNode)),
            ),
          ).pipe(Effect.scoped),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const rendered = String(exit.cause);
          expect(rendered).toContain("IdentitySelfRequired");
        }
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));

  it("first claimant serves; second becomes a client of the winner", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("claim-lookup");
        const winnerPath = yield* tmpSock("claim-winner");
        const loserPath = yield* tmpSock("claim-loser");

        const lookupNode = Lookup.LookupNode("identity/claim-lookup", {
          path: lookupPath,
        });
        class WinnerNode extends Resource.Node<WinnerNode>("identity/winner", {
          path: winnerPath,
        }) {}
        class LoserNode extends Resource.Node<LoserNode>("identity/loser", {
          path: loserPath,
        }) {}

        const lookupClient = Lookup.client(lookupNode);

        // Lookup server first, then winner serve (claims + listens), then loser layer.
        const lookupCtx = yield* Layer.build(Lookup.layer(lookupNode));
        const winnerCtx = yield* Layer.build(
          Resource.ipcServer(
            [Resource.serve(Mail, mailImpl, { self: WinnerNode })],
            { path: winnerPath },
          ).pipe(Layer.provide(lookupClient)),
        );
        const loserCtx = yield* Layer.build(
          Resource.layer(Mail, mailImpl, { self: LoserNode }).pipe(
            Layer.provide(lookupClient),
          ),
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
    ));
});
