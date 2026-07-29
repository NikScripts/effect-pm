/**
 * @module internal/nodeDrainClient
 *
 * Public {@link Node.drain} dial — calls the reserved node-status `drain` RPC on an
 * addressed peer (verify off; status probe path).
 */
import { Effect, Layer, Predicate } from "effect";
import * as Hyperlink from "../Hyperlink";
import {
  isAddressedNode,
  NodeUnreachable,
  UnaddressedNode,
  type AnyNode,
} from "./nodeCore";

/**
 * Enter intentional drain on `node` — sets status `phase: "draining"`.
 *
 * Keeps the process reachable (ping/status stay up). Cooperative `yield` refuses while
 * draining so Lookup `askIncumbent` cannot steal the Directory row. Does **not** unregister,
 * clear Advice, or exit the process (compose those later / {@link Node} shutdown sequence).
 *
 * @category services
 * @public
 */
export const drain = (
  node: AnyNode,
): Effect.Effect<void, NodeUnreachable | UnaddressedNode> => {
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
    yield* Effect.logDebug("Node.drain dialing peer").pipe(
      Effect.annotateLogs({
        "drain.node": node.key,
        "drain.address": address,
      }),
    );
    const { NodeStatusTag } = yield* Effect.promise(() => import("./nodeStatus"));
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, node).pipe(
        Layer.provide(Hyperlink.clientVerify(false)),
      ),
    );
    yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.drain;
    }).pipe(Effect.provide(ctx));
    yield* Effect.logInfo("Node.drain acknowledged").pipe(
      Effect.annotateLogs({ "drain.node": node.key }),
    );
  }).pipe(
    Effect.scoped,
    Effect.withLogSpan("node.drain"),
    Effect.withSpan("node.drain", {
      attributes: { "drain.node": node.key },
    }),
    Effect.mapError((cause) => {
      if (Predicate.isTagged(cause, "UnaddressedNode")) return cause;
      return new NodeUnreachable({
        node: node.key,
        url: address,
        cause,
      });
    }),
  );
};
