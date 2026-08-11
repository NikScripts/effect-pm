/**
 * @module examples/node/forward-proxy
 *
 * Stable public Http → edge `Node.forward` → Active labeled Unix A/B.
 * Flip with `Node.activate` without restarting the edge.
 *
 * ```bash
 * pnpm run example:node-forward-proxy
 * ```
 *
 * Split: [`shared.ts`](./shared.ts) (Tags + public/private Node) · this file (roles + run).
 * Dock: `docs/handoffs/node-addresses-and-update-api.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer } from "effect";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Node from "../../../src/Node";
import * as NodePolicy from "../../../src/NodePolicy";
import { Probe, Worker, WorkerPrivate } from "./shared";

const edge = Node.withPolicy(
  WorkerPrivate,
  NodePolicy.listen("Primary"),
  NodePolicy.active("A"),
  NodePolicy.advertise("Primary"),
);

const backendA = Node.withPolicy(
  WorkerPrivate,
  NodePolicy.as("A"),
  NodePolicy.listen(["A"]),
);

const backendB = Node.withPolicy(
  WorkerPrivate,
  NodePolicy.as("B"),
  NodePolicy.listen(["B"]),
);

const edgeLayer = Node.http(edge, [Node.forward(edge, Probe)]);

const aLayer = Node.unix(
  backendA,
  [Hyperlink.serve(Probe, { tip: Effect.succeed("v1") })],
  { unlink: true },
);

const bLayer = Node.unix(
  backendB,
  [Hyperlink.serve(Probe, { tip: Effect.succeed("v2") })],
  { unlink: true },
);

const program = Effect.gen(function* () {
  const probe = yield* Probe;

  const tipA = yield* probe.tip;
  yield* Effect.logInfo(`tip via Active A → ${tipA}`);

  yield* Node.activate(WorkerPrivate, "B");

  const tipB = yield* probe.tip;
  yield* Effect.logInfo(`tip via Active B → ${tipB}`);

  if (tipA !== "v1" || tipB !== "v2") {
    return yield* Effect.die(
      new Error(`expected v1→v2, got ${tipA}→${tipB}`),
    );
  }

  yield* Effect.logInfo("Done — public Worker dial; edge retargeted A→B.");
}).pipe(
  Effect.provide(
    Hyperlink.client(Probe, Worker).pipe(
      Layer.provide(Layer.mergeAll(edgeLayer, aLayer, bLayer)),
    ),
  ),
  Effect.scoped,
);

// ---cut-after---
NodeRuntime.runMain(program);
