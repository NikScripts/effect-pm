/**
 * @module internal/nodeAssumeClient
 *
 * Public {@link Node.assume} dial — calls the reserved node-status `assume` RPC on an
 * addressed peer (verify off; this *is* the handoff probe).
 */
import { Config, Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../Hyperlink";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
} from "./nodeAssume";
import {
  isAddressedNode,
  NodeUnreachable,
  UnaddressedNode,
  type AnyNode,
} from "./nodeCore";

/** Default env / Config name for local Node token injection sugar. @internal */
export const ASSUME_TOKEN_ENV = "HYPERLINK_ASSUME_TOKEN";

/**
 * Effect {@link Config} for the local assume token (`HYPERLINK_ASSUME_TOKEN`) — optional
 * injection sugar; not the wire protocol.
 *
 * @category config
 * @public
 */
export const assumeTokenConfig = Config.redacted(ASSUME_TOKEN_ENV);

/**
 * Call {@link NodeStatusTag}.`assume` on `node` with `{ token }` — Track A ownership ack.
 *
 * @category services
 * @public
 */
export const assume = (
  node: AnyNode,
  payload: { readonly token: string },
): Effect.Effect<
  void,
  | AssumeTokenMismatch
  | AssumeTokenReused
  | AssumeNotReady
  | NodeUnreachable
  | UnaddressedNode
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
    yield* Effect.logDebug("Node.assume dialing peer").pipe(
      Effect.annotateLogs({
        "assume.node": node.key,
        "assume.address": address,
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
      return yield* status.assume(payload);
    }).pipe(Effect.provide(ctx));
    yield* Effect.logInfo("Node.assume acknowledged").pipe(
      Effect.annotateLogs({ "assume.node": node.key }),
    );
  }).pipe(
    Effect.scoped,
    Effect.withLogSpan("node.assume"),
    Effect.mapError((cause) => {
      if (Schema.is(AssumeTokenMismatch)(cause)) return cause;
      if (Schema.is(AssumeTokenReused)(cause)) return cause;
      if (Schema.is(AssumeNotReady)(cause)) return cause;
      if (cause instanceof UnaddressedNode) return cause;
      return new NodeUnreachable({
        node: node.key,
        url: address,
        cause,
      });
    }),
  );
};
