import { Context, Effect, Layer, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Group from "../src/Group";
import * as Node from "../src/Node";

// The real target topology: a ServicesHub group containing league groups (nesting), where almost
// everything runs LOCAL on one Droplet (provided by its `.layer`) and one member runs REMOTE on
// the Mini (a different node, reached by a client). One runtime, one group tree, mixed provision —
// reached uniformly through the group accessors. This is the ProcessManager-free deploy shape.

class MiniNode extends Node.Tag<MiniNode>("hub/miniNode") {}

// Local on the Droplet (no node) — stands in for a roster import queue.
class RosterQueue extends Resource.Tag<RosterQueue>()("hub/RosterQueue", {
  count: Resource.effect(Schema.Number),
}) {}

// Remote on the Mini (node-bound) — stands in for the one poller that runs on the mini.
class LiveScorePoller extends Resource.Tag<LiveScorePoller>()("hub/LiveScorePoller", 
  { where: Resource.effect(Schema.String) },
  { node: MiniNode },
) {}

// Nested groups: Hub → Nwsl league → members. (Two more leagues would just be more members.)
class NwslLeague extends Group.Tag<NwslLeague>("hub/Nwsl")({
  RosterQueue,
  LiveScorePoller,
}) {}
class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Nwsl: NwslLeague,
}) {}

// The Mini nodes the poller.
const MiniServer = Node.httpServer([
  Resource.serve(LiveScorePoller, {
    where: Effect.succeed("poller@mini"),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

// The Droplet runs the roster queue locally.
const RosterLocal = Resource.layer(RosterQueue, { count: Effect.succeed(42) });

const portOf = (ctx: Context.Context<HttpServer.HttpServer>): number => {
  const address = Context.get(ctx, HttpServer.HttpServer).address;
  return address._tag === "TcpAddress" ? address.port : 0;
};

it("nested hub group: local members + one remote (mini) member, one runtime", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const portMini = portOf(yield* Layer.build(MiniServer));

      // The Droplet runtime: local layer for the queue + a client for the mini poller.
      const dropletRuntime = Layer.mergeAll(
        RosterLocal,
        Resource.client(LiveScorePoller).pipe(
          Layer.provide(
            Resource.httpClient(MiniNode, {
              url: `http://127.0.0.1:${portMini}/rpc`,
            }),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        // both reached through the nested group tree — provision differs, surface is identical
        const roster = yield* ServicesHub.Nwsl.RosterQueue; // local on the droplet
        const poller = yield* ServicesHub.Nwsl.LiveScorePoller; // remote on the mini
        expect(yield* roster.count).toBe(42);
        expect(yield* poller.where).toBe("poller@mini");
      }).pipe(Effect.provide(dropletRuntime), Effect.scoped);
    }).pipe(Effect.scoped),
  ));
