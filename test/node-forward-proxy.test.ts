/**
 * Dream β slice — primary Http forwards to Active Unix backend via Node.forward.
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

describe("Node.forward + Active (Proxy Prefer)", () => {
  it.effect("primary Http dials Active Unix backend; activate retargets", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const sockA = `/tmp/hyperlink-forward-a-${String(now)}.sock`;
      const sockB = `/tmp/hyperlink-forward-b-${String(now)}.sock`;

      class Worker extends Node.make(
        "test/forward-proxy/Worker",
        Address.http(":18765"),
      ).pipe(
        Address.unix("A", sockA),
        Address.unix("B", sockB),
        NodePolicy.proxy("Prefer"),
        NodePolicy.active("A"),
        NodePolicy.listen("Primary"),
        NodePolicy.advertise("Primary"),
      ) {}

      class WorkerA extends Node.make(
        "test/forward-proxy/Worker",
        Address.http(":18765"),
      ).pipe(
        Address.unix("A", sockA),
        Address.unix("B", sockB),
        NodePolicy.as("A"),
        NodePolicy.listen(["A"]),
        NodePolicy.advertise("Primary"),
      ) {}

      class WorkerB extends Node.make(
        "test/forward-proxy/Worker",
        Address.http(":18765"),
      ).pipe(
        Address.unix("A", sockA),
        Address.unix("B", sockB),
        NodePolicy.as("B"),
        NodePolicy.listen(["B"]),
        NodePolicy.advertise("Primary"),
      ) {}

      const worker = Worker as unknown as AnyNode & { readonly key: string };
      const workerA = WorkerA as unknown as AnyNode & { readonly key: string };
      const workerB = WorkerB as unknown as AnyNode & { readonly key: string };
      const workerDial = Worker as unknown as AddressedNode<unknown>;

      const backendA = Node.unix(workerA, [
        Hyperlink.serve(Probe, { tip: Effect.succeed("v1") }),
      ], { unlink: true });

      const backendB = Node.unix(workerB, [
        Hyperlink.serve(Probe, { tip: Effect.succeed("v2") }),
      ], { unlink: true });

      const edge = Node.http(worker, [Node.forward(worker, Probe)]);

      const program = Effect.gen(function* () {
        const probe = yield* Probe;
        expect(yield* probe.tip).toBe("v1");
        yield* Node.activate(worker, "B");
        expect(yield* probe.tip).toBe("v2");
      });

      yield* program.pipe(
        Effect.provide(
          Hyperlink.client(Probe, workerDial).pipe(
            Layer.provide(Layer.mergeAll(edge, backendA, backendB)),
          ),
        ),
        Effect.scoped,
      );
    }),
  );

  it("listen set stamps bind dial (WorkerA → Unix, not primary Http)", () => {
    class WorkerA extends Node.make(
      "test/forward-proxy/Stamp",
      Address.http(":18766"),
    ).pipe(
      Address.unix("A", "/tmp/forward-stamp-a.sock"),
      NodePolicy.as("A"),
      NodePolicy.listen(["A"]),
    ) {}

    expect(
      (WorkerA as unknown as { readonly kind: string }).kind,
    ).toBe("IpcSocket");
    expect(
      (WorkerA as unknown as { readonly path: string }).path,
    ).toBe("/tmp/forward-stamp-a.sock");
  });
});
