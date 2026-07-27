/**
 * @module internal/nodeAssume
 *
 * Launcher → node ownership ack (`Node.assume`) — Schema'd wire errors and ownership mirror.
 * The handshake lives on the reserved node-status Hyperlink; injection of the token into the
 * child is open (env / argv / Config) and is not part of this protocol.
 */
import { Schema } from "effect";

/**
 * Custody mirror on {@link Node.Status} when the node was started with an assume token.
 *
 * - `"launcher"` — child has not yet acked; parent still holds custody.
 * - `"self"` — child assumed ownership (or no assume token was configured).
 *
 * @internal
 */
export type NodeOwnership = "launcher" | "self";

/** Wire schema for {@link NodeOwnership}. @internal */
export const nodeOwnership = Schema.Literals(["launcher", "self"]);

/**
 * `Node.assume` was called with a token that does not match the node's expected token
 * (or the node has no assume token configured).
 *
 * @category errors
 * @public
 */
export class AssumeTokenMismatch extends Schema.TaggedErrorClass<AssumeTokenMismatch>()(
  "AssumeTokenMismatch",
  {
    node: Schema.String,
  },
) {}

/**
 * `Node.assume` succeeded once already — tokens are single-use for Track A handoff.
 *
 * @category errors
 * @public
 */
export class AssumeTokenReused extends Schema.TaggedErrorClass<AssumeTokenReused>()(
  "AssumeTokenReused",
  {
    node: Schema.String,
  },
) {}

/**
 * `Node.assume` rejected because the node is not Ready yet (served resources not all ready,
 * or a configured subset is not ready). Ready ≠ ownership — wait for Ready, then assume.
 *
 * @category errors
 * @public
 */
export class AssumeNotReady extends Schema.TaggedErrorClass<AssumeNotReady>()(
  "AssumeNotReady",
  {
    node: Schema.String,
    resource: Schema.optionalKey(Schema.String),
    detail: Schema.optionalKey(Schema.String),
  },
) {}

/** Wire error union for {@link NodeStatusTag}.`assume`. @internal */
export const assumeError = Schema.Union([
  AssumeTokenMismatch,
  AssumeTokenReused,
  AssumeNotReady,
]);

/** Cleartext assume-token payload on the wire. @internal */
export const assumePayload = Schema.Struct({
  token: Schema.String,
});
