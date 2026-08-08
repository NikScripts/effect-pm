/**
 * @module internal/nodeShutdownClient
 *
 * Public {@link Node.shutdown} dial — drain → leave membership → exit listen scope.
 */
import { Effect, Layer, Predicate } from "effect";
import * as Hyperlink from "../Hyperlink";
import * as Policy from "../Policy";
import {
  isAddressedNode,
  NodeUnreachable,
  UnaddressedNode,
  type AnyNode,
} from "./nodeCore";

/**
 * Compose Track C leave on `node`: drain → Advice clear → Directory unregister →
 * close the listen scope (socket unlink / Layer.launch exits). Idempotent.
 *
 * Prefer this over chaining {@link Node.drain} + manual Lookup calls. Does **not** use
 * `Launcher.kill` or raw `process.exit`.
 *
 * @category services
 * @public
 */
export const shutdown = (
  node: AnyNode,
): Effect.Effect<
  void,
  NodeUnreachable | UnaddressedNode | Hyperlink.HandoffDeferred
> => {
  if (!isAddressedNode(node)) {
    return Effect.fail(new UnaddressedNode({ node: node.key }));
  }
  const address =
    typeof node.url === "string"
      ? node.url
      : typeof node.path === "string"
        ? node.path
        : node.key;
  return Effect.gen(function* () {
    yield* Effect.logDebug("Node.shutdown dialing peer").pipe(
      Effect.annotateLogs({
        "shutdown.node": node.key,
        "shutdown.address": address,
      }),
    );
    const { NodeStatusTag } = yield* Effect.promise(() => import("./nodeStatus"));
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, node).pipe(
        Policy.provide(Policy.verifyOff),
      ),
    );
    yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.shutdown;
    }).pipe(Effect.provide(ctx));
    yield* Effect.logInfo("Node.shutdown acknowledged").pipe(
      Effect.annotateLogs({ "shutdown.node": node.key }),
    );
  }).pipe(
    Effect.scoped,
    Effect.withLogSpan("node.shutdown"),
    Effect.withSpan("node.shutdown", {
      attributes: { "shutdown.node": node.key },
    }),
    Effect.mapError((cause) => {
      if (Predicate.isTagged(cause, "UnaddressedNode")) return cause;
      if (Predicate.isTagged(cause, "HandoffDeferred")) return cause;
      return new NodeUnreachable({
        node: node.key,
        url: address,
        cause,
      });
    }),
  );
};
