/**
 * Dream β — one Node.make; edge/backend roles via Node.withPolicy.
 */
import { Clock, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Address from "../src/Address";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import type { AddressedNode, AnyNode } from "../src/Node";
import * as NodePolicy from "../src/NodePolicy";

class Probe extends Hyperlink.Service<Probe>()("test/forward-proxy/Probe", {
  tip: Hyperlink.effect(Schema.String),
}) {}

describe("Node.forward + withPolicy (one make)", () => {
  it.effect("one Worker make; edge forward + backend as/listen overlays", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const sockA = `/tmp/hyperlink-forward-a-${String(now)}.sock`;
      const sockB = `/tmp/hyperlink-forward-b-${String(now)}.sock`;

      // ONE make — one node identity, one key.
      class Worker extends Node.make(
        "test/forward-proxy/Worker",
        Address.http(":18765"),
      ).pipe(
        Address.unix("A", sockA),
        Address.unix("B", sockB),
        NodePolicy.proxy("Prefer"),
      ) {}

      const worker = Worker as unknown as AnyNode & { readonly key: string };
      const workerDial = Worker as unknown as AddressedNode<unknown>;

      // Process roles — overlays on the same make, never a second make.
      const edgeNode = Node.withPolicy(
        worker,
        NodePolicy.listen("Primary"),
        NodePolicy.active("A"),
        NodePolicy.advertise("Primary"),
      );
      const backendA = Node.withPolicy(
        worker,
        NodePolicy.as("A"),
        NodePolicy.listen(["A"]),
      );
      const backendB = Node.withPolicy(
        worker,
        NodePolicy.as("B"),
        NodePolicy.listen(["B"]),
      );

      const edge = Node.http(edgeNode, [Node.forward(edgeNode, Probe)]);
      const a = Node.unix(
        backendA,
        [Hyperlink.serve(Probe, { tip: Effect.succeed("v1") })],
        { unlink: true },
      );
      const b = Node.unix(
        backendB,
        [Hyperlink.serve(Probe, { tip: Effect.succeed("v2") })],
        { unlink: true },
      );

      const program = Effect.gen(function* () {
        const probe = yield* Probe;
        expect(yield* probe.tip).toBe("v1");
        yield* Node.activate(worker, "B");
        expect(yield* probe.tip).toBe("v2");
      });

      yield* program.pipe(
        Effect.provide(
          Hyperlink.client(Probe, workerDial).pipe(
            Layer.provide(Layer.mergeAll(edge, a, b)),
          ),
        ),
        Effect.scoped,
      );
    }),
  );

  it("withPolicy listen stamps bind dial without a second make", () => {
    class Worker extends Node.make(
      "test/forward-proxy/Stamp",
      Address.http(":18766"),
    ).pipe(Address.unix("A", "/tmp/forward-stamp-a.sock")) {}

    const backend = Node.withPolicy(
      Worker as unknown as AnyNode & { readonly key: string },
      NodePolicy.as("A"),
      NodePolicy.listen(["A"]),
    );

    expect(backend.kind).toBe("IpcSocket");
    expect(backend.path).toBe("/tmp/forward-stamp-a.sock");
    expect(backend.key).toBe("test/forward-proxy/Stamp");
    // Same address list identity as the make.
    expect(Node.addressesOf(backend)).toEqual(Node.addressesOf(Worker));
  });
});
