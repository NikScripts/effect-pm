/**
 * Dream β — public Node.make; private dials via Public.pipe; roles via withPolicy.
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

describe("Node.forward + withPolicy (public / private)", () => {
  it.effect("public make; private pipe; edge forward + backend overlays", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const sockA = `/tmp/hyperlink-forward-a-${String(now)}.sock`;
      const sockB = `/tmp/hyperlink-forward-b-${String(now)}.sock`;

      // Public identity — client-facing dial only (no A/B on construction).
      class Worker extends Node.make(
        "test/forward-proxy/Worker",
        Address.http(":18765"),
      ) {}

      // Private dials + proxy — same key via pipe, never a second make.
      class WorkerPrivate extends Worker.pipe(
        Address.unix({ A: sockA, B: sockB }),
        NodePolicy.proxy("Prefer"),
      ) {}

      const privateNode = WorkerPrivate as unknown as AnyNode & {
        readonly key: string;
      };
      const publicDial = Worker as unknown as AddressedNode<unknown>;

      // Process roles — overlays on the private view, never a second make.
      const edgeNode = Node.withPolicy(
        privateNode,
        NodePolicy.listen("Primary"),
        NodePolicy.active("A"),
        NodePolicy.advertise("Primary"),
      );
      const backendA = Node.withPolicy(
        privateNode,
        NodePolicy.as("A"),
        NodePolicy.listen(["A"]),
      );
      const backendB = Node.withPolicy(
        privateNode,
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
        yield* Node.activate(privateNode, "B");
        expect(yield* probe.tip).toBe("v2");
      });

      yield* program.pipe(
        Effect.provide(
          Hyperlink.client(Probe, publicDial).pipe(
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
    ) {}
    class WorkerPrivate extends Worker.pipe(
      Address.unix({ A: "/tmp/forward-stamp-a.sock" }),
    ) {}

    const backend = Node.withPolicy(
      WorkerPrivate as unknown as AnyNode & { readonly key: string },
      NodePolicy.as("A"),
      NodePolicy.listen(["A"]),
    );

    expect(backend.kind).toBe("IpcSocket");
    expect(backend.path).toBe("/tmp/forward-stamp-a.sock");
    expect(backend.key).toBe("test/forward-proxy/Stamp");
    expect(Worker.key).toBe(WorkerPrivate.key);
    // Public keeps only the client dial; private carries A/B (here A).
    expect(Node.addressesOf(Worker)).toHaveLength(1);
    expect(Node.addressesOf(WorkerPrivate)).toHaveLength(2);
    expect(Node.addressesOf(backend)).toEqual(Node.addressesOf(WorkerPrivate));
  });
});
